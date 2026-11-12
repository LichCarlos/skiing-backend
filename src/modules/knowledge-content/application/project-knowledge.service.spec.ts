import { describe, expect, it, vi } from 'vitest';
import { ProjectKnowledgeService } from './project-knowledge.service.js';
import type {
  ProjectKnowledgeRepository,
  ProjectKnowledgeTransaction,
} from './ports/project-knowledge-repository.js';
import { projectKnowledgeRecord } from '../../../../test/fixtures/content-records.js';

const audit = {
  actorUserId: 3,
  traceId: 'trace',
  clientIp: null,
  userAgent: null,
};
const body = {
  title: 'Platform',
  content: 'Public instructions',
  category: 'platform',
};
function setup() {
  let row = projectKnowledgeRecord();
  const tx = {
    authorize: vi.fn(async () => undefined),
    find: vi.fn(async () => ({ ...row })),
    create: vi.fn(async () => row),
    update: vi.fn(async (_id, _version, change) => {
      row = {
        ...row,
        ...change.values,
        ...(change.status ? { status: change.status } : {}),
        ...(change.publishTime ? { publishTime: change.publishTime } : {}),
        ...(change.deletedAt ? { deletedAt: change.deletedAt } : {}),
        version: row.version + 1,
      };
      return true;
    }),
    appendChanged: vi.fn(async (_id: number, _status: string) => {}),
    audit: vi.fn(async () => {}),
  } satisfies ProjectKnowledgeTransaction;
  const repository = {
    find: vi.fn(async () => row),
    findPage: vi.fn(async () => ({ items: [row], total: 1 })),
    async runWrite<T>(
      work: (tx: ProjectKnowledgeTransaction) => Promise<T>,
    ): Promise<T> {
      return work(tx);
    },
  } satisfies ProjectKnowledgeRepository;
  return { service: new ProjectKnowledgeService(repository), repository, tx };
}
describe('ProjectKnowledgeService application ports', () => {
  it('rejects client version mismatch before opening a write', async () => {
    const { service, tx } = setup();
    await expect(
      service.update(7, { ...body, version: 1 }, audit),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.update).not.toHaveBeenCalled();
  });
  it('rejects a concurrent database version mismatch without event/audit', async () => {
    const { service, tx } = setup();
    tx.update.mockResolvedValueOnce(false);
    await expect(
      service.update(7, { ...body, version: 2 }, audit),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.appendChanged).not.toHaveBeenCalled();
    expect(tx.audit).not.toHaveBeenCalled();
  });
  it('publishes drafts, keeps first publication on republish, and rejects repeated publish', async () => {
    const { service, tx } = setup();
    const first = await service.publish(7, audit);
    expect(first).toMatchObject({ status: 'published', version: 3 });
    await expect(service.publish(7, audit)).rejects.toMatchObject({
      status: 409,
    });
    await service.withdraw(7, audit);
    const republished = await service.publish(7, audit);
    expect(republished!.publishTime).toBe(first!.publishTime);
    expect(tx.appendChanged.mock.calls.map((call) => call[1])).toEqual([
      'published',
      'withdrawn',
      'published',
    ]);
  });
  it('soft-deletes with a tombstone event and audited before/after', async () => {
    const { service, tx } = setup();
    await expect(service.remove(7, audit)).resolves.toBeUndefined();
    expect(tx.update).toHaveBeenCalledWith(7, 2, {
      deletedAt: expect.any(Date),
    });
    expect(tx.appendChanged).toHaveBeenCalledWith(7, 'deleted');
    expect(tx.audit).toHaveBeenCalledWith(
      audit,
      7,
      expect.objectContaining({
        after: expect.objectContaining({ deleted: true, version: 3 }),
      }),
    );
  });
  it('preserves HTTP validation distinctions for unsafe content and malformed URLs', async () => {
    const { service, tx } = setup();
    await expect(
      service.create({ ...body, content: 'api_key=secret' }, audit),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      service.create({ ...body, sourceUrl: 'file:///private' }, audit),
    ).rejects.toMatchObject({ status: 400 });
    expect(tx.create).not.toHaveBeenCalled();
  });
});
