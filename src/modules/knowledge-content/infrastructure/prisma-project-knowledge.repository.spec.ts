import { PrismaProjectKnowledgeRepository } from './prisma-project-knowledge.repository.js';
import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { OutboxStore } from '../../integration-events/application/ports/outbox-store.js';
import { ProjectKnowledgeService } from '../application/project-knowledge.service.js';

const audit = {
  actorUserId: 8,
  traceId: 'trace-project-knowledge',
  clientIp: null,
  userAgent: null,
};

function setup(initialStatus = 'draft') {
  const now = new Date('2026-10-28T00:00:00.000Z');
  let row = {
    ProjectKnowledgeId: 7,
    Title: '项目说明',
    Content: '公开介绍',
    Category: '平台说明',
    SourceUrl: null as string | null,
    Status: initialStatus,
    PublishTime: null as Date | null,
    Version: 2,
    CreateTime: now,
    UpdateTime: now,
    DeletedAt: null as Date | null,
  };
  const events: string[] = [];
  const tx = {
    projectKnowledge: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        row = { ...row, ...data, ProjectKnowledgeId: 7 } as typeof row;
        events.push('create');
        return row;
      }),
      findFirst: vi.fn(async ({ where }: { where: { DeletedAt?: null } }) =>
        row.DeletedAt && where.DeletedAt === null ? null : { ...row },
      ),
      findUniqueOrThrow: vi.fn(async () => row),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          if (
            where.Version !== row.Version ||
            where.ProjectKnowledgeId !== row.ProjectKnowledgeId
          )
            return { count: 0 };
          row = {
            ...row,
            ...data,
            Version:
              typeof data.Version === 'object' ? row.Version + 1 : row.Version,
          } as typeof row;
          events.push(`update:${row.Status}`);
          return { count: 1 };
        },
      ),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        Account: 'admin',
        UserId: 8,
        Status: 'active',
        MerchantProfile: null,
        UserRoles: [
          {
            Role: {
              RoleKey: 'system_admin',
              Status: 'active',
              DataScope: 'all',
              DataScopes: [],
              RolePermissions: [
                'management:portal:enter',
                ...['create', 'update', 'publish', 'withdraw', 'delete'].map(
                  (action) => `content:project-knowledge:${action}`,
                ),
              ].map((PermissionKey) => ({
                Permission: { PermissionKey, Status: 'active' },
              })),
            },
          },
        ],
      }),
    },
    operationLog: {
      create: vi.fn(async () => {
        events.push('audit');
        return {};
      }),
    },
  };
  const prisma = {
    projectKnowledge: tx.projectKnowledge,
    $transaction: vi.fn(async (work: (transaction: unknown) => unknown) =>
      work(tx),
    ),
  };
  const outbox = {
    append: vi.fn(
      async (
        _tx: unknown,
        event: { eventType: string; payload: { status: string } },
      ) => {
        events.push(`outbox:${event.eventType}:${event.payload.status}`);
      },
    ),
  };
  return {
    service: new ProjectKnowledgeService(
      new PrismaProjectKnowledgeRepository(
        prisma as unknown as PrismaService,
        outbox as unknown as OutboxStore,
      ),
    ),
    tx,
    outbox,
    events,
    get row() {
      return row;
    },
  };
}

describe('ProjectKnowledgeService', () => {
  it('creates a draft and writes the outbox event and audit in the transaction', async () => {
    const { service, tx, outbox, events } = setup();
    await expect(
      service.create(
        { title: ' 平台说明 ', content: '项目介绍', category: ' 平台 ' },
        audit,
      ),
    ).resolves.toMatchObject({
      projectKnowledgeId: 7,
      status: 'draft',
      version: 2,
    });
    expect(outbox.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'project_doc.changed.v1',
        payload: { projectKnowledgeId: 7, status: 'draft' },
      }),
    );
    expect(tx.operationLog.create).toHaveBeenCalledOnce();
    expect(events).toEqual([
      'create',
      'outbox:project_doc.changed.v1:draft',
      'audit',
    ]);
  });

  it('publishes only a draft and sets the first publication time', async () => {
    const { service, events } = setup();
    await expect(service.publish(7, audit)).resolves.toMatchObject({
      status: 'published',
      publishTime: expect.any(String),
      version: 3,
    });
    expect(events).toEqual([
      'update:published',
      'outbox:project_doc.changed.v1:published',
      'audit',
    ]);
  });

  it('rejects stale versions and sensitive content without committing writes', async () => {
    const stale = setup();
    await expect(
      stale.service.update(
        7,
        { title: '说明', content: '内容', category: '平台', version: 1 },
        audit,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(stale.outbox.append).not.toHaveBeenCalled();
    const sensitive = setup();
    await expect(
      sensitive.service.create(
        { title: '说明', content: 'password=example-secret', category: '平台' },
        audit,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(sensitive.tx.projectKnowledge.create).not.toHaveBeenCalled();
  });
});
