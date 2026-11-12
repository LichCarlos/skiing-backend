import { describe, expect, it, vi } from 'vitest';
import { PrismaRagSourceReader } from './prisma-rag-source.reader.js';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { InboxLease } from '../../integration-events/application/ports/inbox-lease.js';
import type { IntegrationEvent } from '../../integration-events/domain/integration-event.js';
import type { RagDocumentIndexingService } from '../application/rag-document-indexing.service.js';
import type { RagDocumentWriter } from '../application/ports/rag-document-writer.js';
import { DynamicRagEventHandler } from '../application/dynamic-rag-event-handler.js';

const event: IntegrationEvent = {
  eventId: 'c9a5b5d0-6ba3-4fe0-8f4e-7d8478b2bacc',
  eventType: 'dynamic.changed.v1',
  aggregateType: 'Dynamic',
  aggregateId: '7',
  occurredAt: new Date('2026-10-28T00:00:00Z'),
  payload: { dynamicId: 7 },
};

function setup(dynamic: unknown, processed = false) {
  const prisma = {
    customFieldDefinition: { findMany: vi.fn().mockResolvedValue([]) },
    dynamic: { findUnique: vi.fn().mockResolvedValue(dynamic) },
  } as unknown as PrismaService;
  Object.assign(prisma, {
    $transaction: vi.fn((work: (tx: PrismaService) => Promise<unknown>) =>
      work(prisma),
    ),
  });
  const claim = vi
    .fn()
    .mockResolvedValue(processed ? null : { lockToken: 'lock-1' });
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
  return {
    handler: new DynamicRagEventHandler(
      new PrismaRagSourceReader(prisma),
      inbox,
      indexing as unknown as RagDocumentIndexingService,
      writer as unknown as RagDocumentWriter,
    ),
    claim,
    complete,
    release,
    indexing,
    writer,
  };
}

const published = {
  DynamicId: 7,
  Content: '今天第一次滑蓝道。',
  Status: 'published',
  DeletedAt: null,
  UpdateTime: new Date('2026-10-28T00:00:00Z'),
  Author: { Nickname: '雪友', Status: 'active' },
  Resort: { Name: '北山滑雪场', Status: 'published', DeletedAt: null },
};

describe('DynamicRagEventHandler', () => {
  it('indexes public dynamics and their resort context', async () => {
    const { handler, indexing, complete } = setup(published);
    await expect(handler.handle(event)).resolves.toBe(true);
    expect(indexing.index).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKey: 'dynamic:7',
        sourceType: 'dynamic',
        accessScope: 'public',
        merchantId: null,
        title: '滑雪动态：雪友',
        content: expect.stringContaining('关联雪场：北山滑雪场'),
      }),
    );
    expect(complete).toHaveBeenCalledOnce();
  });

  it.each([
    [null, 'missing'],
    [{ ...published, Status: 'pending' }, 'unpublished'],
    [{ ...published, DeletedAt: new Date() }, 'deleted'],
    [
      { ...published, Author: { Nickname: '雪友', Status: 'disabled' } },
      'inactive author',
    ],
    [
      {
        ...published,
        Resort: { Name: '北山', Status: 'hidden', DeletedAt: null },
      },
      'hidden resort',
    ],
  ])('disables %s dynamics', async (dynamic, _caseName) => {
    const { handler, writer, indexing } = setup(dynamic);
    await expect(handler.handle(event)).resolves.toBe(true);
    expect(writer.disable).toHaveBeenCalledWith('dynamic:7');
    expect(indexing.index).not.toHaveBeenCalled();
  });

  it('skips duplicates and rejects malformed identities before claiming', async () => {
    const duplicate = setup(published, true);
    await expect(duplicate.handler.handle(event)).resolves.toBe(false);
    expect(duplicate.indexing.index).not.toHaveBeenCalled();

    const invalid = setup(published);
    await expect(
      invalid.handler.handle({ ...event, payload: { dynamicId: '7' } }),
    ).rejects.toThrow('positive integer dynamicId');
    expect(invalid.claim).not.toHaveBeenCalled();
  });

  it('releases the inbox claim when indexing fails', async () => {
    const { handler, indexing, release } = setup(published);
    indexing.index.mockRejectedValue(new Error('embedding unavailable'));
    await expect(handler.handle(event)).rejects.toThrow(
      'embedding unavailable',
    );
    expect(release).toHaveBeenCalledOnce();
  });
});
