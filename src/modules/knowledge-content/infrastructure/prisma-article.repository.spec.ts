import { articleActor } from '../../../../test/fixtures/article-actor.js';
import { PrismaArticleRepository } from './prisma-article.repository.js';
import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { AssetStorage } from '../../assets/application/ports/asset-storage.js';
import type { OutboxStore } from '../../integration-events/application/ports/outbox-store.js';
import { AdminArticleService } from '../application/admin-article-service.js';

const scope = { kind: 'all' } as const;
const audit = {
  actorUserId: 3,
  traceId: 'trace-article',
  clientIp: null,
  userAgent: null,
};

function setup(status: string, publishTime: Date | null = null) {
  const existing = {
    ArticleId: 19,
    Title: 'Ski basics',
    Summary: 'Summary',
    Body: 'Body',
    CoverAssetId: null,
    CategoryValue: 'basics',
    AuthorId: 3,
    AuthorName: 'Editor',
    Status: status,
    PublishTime: publishTime,
    Version: 2,
    CustomFields: {},
    SchemaVersion: 1,
    CreateTime: new Date('2026-10-27T00:00:00Z'),
    UpdateTime: new Date('2026-10-27T00:00:00Z'),
    DeletedAt: null,
    Category: { Value: 'basics', Label: '基础知识' },
    CoverAsset: null,
  };
  const events: string[] = [];
  const tx = {
    article: {
      findFirst: vi.fn(async () => ({ ...existing })),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const nextStatus =
          typeof data.Status === 'string'
            ? data.Status
            : data.DeletedAt
              ? 'deleted'
              : 'update';
        events.push(`update:${nextStatus}`);
        Object.assign(existing, data, { Version: existing.Version + 1 });
        return { count: 1 };
      }),
    },
    user: { findUnique: vi.fn().mockResolvedValue(articleActor()) },
    customFieldDefinition: { findMany: vi.fn(async () => []) },
    roleFieldPermission: { findMany: vi.fn(async () => []) },
    operationLog: {
      create: vi.fn(async () => {
        events.push('audit');
        return {};
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (work: (transaction: unknown) => unknown) =>
      work(tx),
    ),
  };
  const outbox = {
    append: vi.fn(
      async (
        _transaction: unknown,
        event: { eventType: string; payload: { status: string } },
      ) => {
        events.push(`outbox:${event.eventType}:${event.payload.status}`);
      },
    ),
  };
  const service = new AdminArticleService(
    new PrismaArticleRepository(
      prisma as unknown as PrismaService,
      outbox as unknown as OutboxStore,
    ),
    { createReadUrl: vi.fn() } as unknown as AssetStorage,
  );
  return { service, tx, outbox, events };
}

describe('AdminArticleService lifecycle', () => {
  it('publishes a draft, records first publication time, outbox and audit', async () => {
    const { service, tx, outbox, events } = setup('draft');
    await expect(service.publish(19, audit, scope)).resolves.toMatchObject({
      status: 'published',
      articleId: 19,
    });
    expect(tx.article.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ DeletedAt: null, Version: 2 }),
        data: expect.objectContaining({
          Status: 'published',
          PublishTime: expect.any(Date),
          Version: { increment: 1 },
        }),
      }),
    );
    expect(outbox.append).toHaveBeenCalledOnce();
    expect(events).toEqual([
      'update:published',
      'outbox:article.changed.v1:published',
      'audit',
    ]);
  });

  it('rejects publishing an already published article without writing side effects', async () => {
    const { service, tx, outbox } = setup('published', new Date());
    await expect(service.publish(19, audit, scope)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.article.updateMany).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
    expect(tx.operationLog.create).not.toHaveBeenCalled();
  });

  it('withdraws only published articles and appends withdrawal event in the transaction', async () => {
    const { service, tx, events } = setup('published', new Date());
    await expect(service.withdraw(19, audit, scope)).resolves.toMatchObject({
      status: 'withdrawn',
    });
    expect(tx.article.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ DeletedAt: null, Version: 2 }),
        data: expect.objectContaining({
          Status: 'withdrawn',
          Version: { increment: 1 },
        }),
      }),
    );
    expect(events).toEqual([
      'update:withdrawn',
      'outbox:article.changed.v1:withdrawn',
      'audit',
    ]);
  });
});
