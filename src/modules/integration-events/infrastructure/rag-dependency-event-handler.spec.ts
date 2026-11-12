import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RagDependencyEventHandler } from './rag-dependency-event-handler.js';
import type { PrismaInboxExecutor } from './prisma-inbox.executor.js';
import type { IntegrationEvent } from '../domain/integration-event.js';
const event = (
  payload: IntegrationEvent['payload'],
  eventType = 'rag.dependencies.changed.v1',
): IntegrationEvent => ({
  eventId: '139dcfd8-dee2-4373-9eed-c46417b56e82',
  eventType,
  aggregateType: 'Test',
  aggregateId: '1',
  payload,
  occurredAt: new Date(),
});
function setup() {
  const tx = {
    $queryRaw: vi
      .fn<(sql: Prisma.Sql) => Promise<unknown[]>>()
      .mockResolvedValueOnce([{ max: 400 }])
      .mockResolvedValueOnce(
        Array.from({ length: 200 }, (_, i) => ({ id: i + 1 })),
      ),
    outboxEvent: {
      create:
        vi.fn<
          (input: {
            data: { Payload: Record<string, unknown> };
          }) => Promise<void>
        >(),
      createMany: vi.fn<(input: { data: unknown[] }) => Promise<void>>(),
    },
    customFieldDefinition: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { EntityType: 'article' },
          { EntityType: 'dynamic' },
          { EntityType: 'merchant_profile' },
        ]),
    },
  };
  const executeOnce = vi.fn(async (_identity, effect) => {
    await effect(tx);
    return true;
  });
  return {
    tx,
    executeOnce,
    sut: new RagDependencyEventHandler({
      executeOnce,
    } as unknown as PrismaInboxExecutor),
  };
}
describe('transactional RAG dependency fanout', () => {
  it('caps each transaction at 200 and carries a fixed high-water mark', async () => {
    const { sut, tx } = setup();
    await sut.handle(event({ entityType: 'dynamic', afterId: 0, authorId: 3 }));
    expect(tx.outboxEvent.createMany.mock.calls[0]![0].data).toHaveLength(200);
    expect(tx.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        Payload: {
          entityType: 'dynamic',
          afterId: 200,
          authorId: 3,
          maxId: 400,
        },
      }),
    });
    const sql = tx.$queryRaw.mock.calls[1]![0];
    expect(sql.sql).toContain('"AuthorId"=?');
    expect(sql.values).toContain(3);
  });
  it('does not widen a resumed job to newly inserted IDs', async () => {
    const { sut, tx } = setup();
    tx.$queryRaw.mockReset().mockResolvedValue([]);
    await sut.handle(
      event({ entityType: 'article', afterId: 200, maxId: 400 }),
    );
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.$queryRaw.mock.calls[0]![0].values).toEqual([200, 400]);
    expect(tx.outboxEvent.createMany).not.toHaveBeenCalled();
  });
  it('rejects unsafe entity and cross-entity constraints before claiming', async () => {
    for (const payload of [
      { entityType: 'User', afterId: 0 },
      { entityType: 'article', afterId: 0, authorId: 1 },
      { entityType: 'dynamic', afterId: 0, resortId: 1, authorId: 1 },
    ] as IntegrationEvent['payload'][]) {
      const { sut, executeOnce } = setup();
      await expect(sut.handle(event(payload))).rejects.toThrow();
      expect(executeOnce).not.toHaveBeenCalled();
    }
  });
  it('lets the Inbox suppress duplicate effects', async () => {
    const { sut, executeOnce, tx } = setup();
    executeOnce.mockImplementationOnce(async () => false);
    expect(await sut.handle(event({ entityType: 'article', afterId: 0 }))).toBe(
      false,
    );
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
  it('rebuilds public custom-field entities when their dictionary changes', async () => {
    const { sut, tx } = setup();
    await sut.handle(
      event({ dictType: 'snow_grade' }, 'dictionary.changed.v1'),
    );
    expect(tx.outboxEvent.create).toHaveBeenCalledTimes(2);
    expect(
      tx.outboxEvent.create.mock.calls.map((c) => c[0].data.Payload.entityType),
    ).toEqual(['article', 'dynamic']);
  });
});
