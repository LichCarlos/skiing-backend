import { describe, expect, it, vi } from 'vitest';
import { PrismaRagSourceReader } from './prisma-rag-source.reader.js';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { InboxLease } from '../../integration-events/application/ports/inbox-lease.js';
import type { IntegrationEvent } from '../../integration-events/domain/integration-event.js';
import type { RagDocumentIndexingService } from '../application/rag-document-indexing.service.js';
import type { RagDocumentWriter } from '../application/ports/rag-document-writer.js';
import { ProjectKnowledgeRagEventHandler } from '../application/project-knowledge-rag-event-handler.js';

const event: IntegrationEvent = {
  eventId: 'c9a5b5d0-6ba3-4fe0-8f4e-7d8478b2bacc',
  eventType: 'project_doc.changed.v1',
  aggregateType: 'project_doc',
  aggregateId: '7',
  occurredAt: new Date(),
  payload: { projectKnowledgeId: 7, status: 'published' },
};

function setup(row: unknown) {
  const prisma = {
    projectKnowledge: { findUnique: vi.fn().mockResolvedValue(row) },
  } as unknown as PrismaService;
  Object.assign(prisma, {
    $transaction: vi.fn((work: (tx: PrismaService) => Promise<unknown>) =>
      work(prisma),
    ),
  });
  const claim = vi.fn().mockResolvedValue({ lockToken: 'lock' });
  const complete = vi.fn().mockResolvedValue(true);
  const release = vi.fn().mockResolvedValue(true);
  const inbox = {
    isProcessed: vi.fn().mockResolvedValue(true),
    claim,
    complete,
    release,
  } as unknown as InboxLease;
  const indexing = { index: vi.fn().mockResolvedValue({ skipped: false }) };
  const writer = { disable: vi.fn().mockResolvedValue(undefined) };
  const handler = new ProjectKnowledgeRagEventHandler(
    new PrismaRagSourceReader(prisma),
    inbox,
    indexing as unknown as RagDocumentIndexingService,
    writer as unknown as RagDocumentWriter,
  );
  return { handler, prisma, claim, complete, release, indexing, writer };
}

const published = {
  PublishTime: new Date('2026-10-28T00:00:00Z'),
  ProjectKnowledgeId: 7,
  Title: '滑雪安全',
  Content: '检查雪况与装备。',
  Category: '安全',
  SourceUrl: 'https://example.org/ski',
  Status: 'published',
  UpdateTime: new Date(),
  DeletedAt: null,
};

describe('ProjectKnowledgeRagEventHandler', () => {
  it.each([
    { Title: 'api_key=legacy-key-marker' },
    { Content: 'refresh_token=legacy-token-marker' },
    { Category: 'person@example.org' },
    { SourceUrl: 'https://person:legacy-password@example.org/guide' },
    { SourceUrl: 'https://example.org/?api%5Fkey=legacy-url-marker' },
    { SourceUrl: 'javascript:alert(1)' },
    { Content: '-----BEGIN PRIVATE KEY-----' },
    { Content: '<script>alert(1)</script>' },
    { Title: '' },
    { Content: 'x'.repeat(100001) },
  ])(
    'disables legacy source failing current publication rules (case %#)',
    async (change) => {
      const { handler, indexing, writer, complete, release } = setup({
        ...published,
        ...change,
      });
      await expect(handler.handle(event)).resolves.toBe(true);
      expect(writer.disable).toHaveBeenCalledWith('project:7');
      expect(indexing.index).not.toHaveBeenCalled();
      expect(complete).toHaveBeenCalledOnce();
      expect(release).not.toHaveBeenCalled();
    },
  );

  it('propagates persistence failures without acknowledging the event', async () => {
    const { handler, prisma, complete, release } = setup(published);
    vi.spyOn(prisma.projectKnowledge, 'findUnique').mockRejectedValueOnce(
      new Error('read failed'),
    );
    await expect(handler.handle(event)).rejects.toThrow('read failed');
    expect(complete).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it('indexes only published sources with project citation identity', async () => {
    const { handler, indexing, complete } = setup(published);
    await expect(handler.handle(event)).resolves.toBe(true);
    expect(indexing.index).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKey: 'project:7',
        sourceType: 'project_doc',
        sourceId: 7,
        accessScope: 'public',
        title: '滑雪安全',
        content: expect.stringContaining('来源：https://example.org/ski'),
      }),
    );
    expect(complete).toHaveBeenCalledOnce();
  });

  it('disables withdrawn and deleted sources, and ignores unrelated events', async () => {
    const withdrawn = setup({ ...published, Status: 'withdrawn' });
    await expect(withdrawn.handler.handle(event)).resolves.toBe(true);
    expect(withdrawn.writer.disable).toHaveBeenCalledWith('project:7');
    const unrelated = setup(published);
    await expect(
      unrelated.handler.handle({ ...event, eventType: 'article.changed.v1' }),
    ).resolves.toBe(false);
    expect(unrelated.claim).not.toHaveBeenCalled();
  });

  it('rejects malformed identities before claiming an inbox event', async () => {
    const { handler, claim } = setup(published);
    await expect(
      handler.handle({ ...event, payload: { projectKnowledgeId: '7' } }),
    ).rejects.toThrow('positive integer projectKnowledgeId');
    expect(claim).not.toHaveBeenCalled();
  });
});
