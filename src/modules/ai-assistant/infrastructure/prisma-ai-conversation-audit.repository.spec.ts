import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { PrismaAiConversationAuditRepository } from './prisma-ai-conversation-audit.repository.js';
import { AuditAiConversations } from '../application/audit-ai-conversations.js';
const id = '078edc04-0d24-4f83-a509-54c472869e70';
const date = new Date('2026-11-01T00:00:00Z');
const grants = [
  'management:portal:enter',
  'system:ai-conversation:list',
  'system:ai-conversation:read-content',
];
function role(scope = 'all', permissions = grants) {
  return {
    Role: {
      RoleKey: 'auditor',
      Status: 'active',
      DataScope: 'self',
      RolePermissions: permissions.map((PermissionKey) => ({
        Permission: { PermissionKey, Status: 'active' },
      })),
      DataScopes: [
        {
          ResourceKey: 'user',
          ScopeType: scope,
          ScopeConfig: scope === 'selected' ? { selectedIds: [7] } : null,
        },
      ],
    },
  };
}
function setup(roles = [role()]) {
  const user = {
    UserId: 1,
    Status: 'active',
    MerchantProfile: { MerchantId: 2, Status: 'active' },
    UserRoles: roles,
  };
  const tx = {
    user: {
      findUnique: vi
        .fn()
        .mockImplementation(async (q) =>
          q.select.Account ? { Account: 'auditor' } : user,
        ),
    },
    aiConversation: {
      findMany: vi.fn().mockResolvedValue([
        {
          ConversationId: id,
          UserId: 7,
          CreateTime: date,
          UpdateTime: date,
          DeletedAt: date,
          _count: { Messages: 2 },
        },
      ]),
      count: vi.fn().mockResolvedValue(1),
      findFirst: vi.fn().mockResolvedValue({
        UserId: 7,
        Messages: [
          {
            MessageId: 9007199254740993n,
            SenderRole: 'user',
            Content: 'secret',
            GenerationStatus: null,
            CreateTime: date,
            Citations: null,
          },
        ],
      }),
    },
    operationLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const transaction = vi.fn(
    (work: (value: typeof tx) => Promise<unknown>, _options?: unknown) =>
      work(tx),
  );
  const repository = new PrismaAiConversationAuditRepository({
    $transaction: transaction,
  } as unknown as PrismaService);
  return { tx, transaction, repository };
}
describe('AI conversation audit snapshot', () => {
  it('reads only minimum metadata with stable ordering, retained deleted rows and matching count', async () => {
    const { repository, tx, transaction } = setup();
    const result = await repository.list(1, {
      page: 2,
      pageSize: 20,
      status: 'deleted',
      userId: 7,
      fromTime: date.toISOString(),
      toTime: date.toISOString(),
    });
    expect(result.items[0]).toEqual({
      conversationId: id,
      userId: 7,
      status: 'deleted',
      createdAt: date.toISOString(),
      updatedAt: date.toISOString(),
      deletedAt: date.toISOString(),
      messageCount: 2,
    });
    const q = tx.aiConversation.findMany.mock.calls[0]![0];
    expect(q.select).not.toHaveProperty('Title');
    expect(q.select).not.toHaveProperty('Messages');
    expect(q.where.AND[0]).toMatchObject({
      UserId: { not: null },
      GuestSessionId: null,
    });
    expect(q.orderBy).toEqual([
      { UpdateTime: 'desc' },
      { ConversationId: 'desc' },
    ]);
    expect(tx.aiConversation.count).toHaveBeenCalledWith({ where: q.where });
    expect(transaction.mock.calls[0]![1]).toEqual({
      isolationLevel: 'RepeatableRead',
    });
  });
  it.each(['self', 'selected'])(
    'applies %s user scope to content reads',
    async (scope) => {
      const { repository, tx } = setup([role(scope)]);
      await repository.readContent(1, id, {
        reason: 'support',
        traceId: 'trace',
      });
      const where = tx.aiConversation.findFirst.mock.calls[0]![0].where.AND[0];
      expect(where.AND).toEqual([
        scope === 'self' ? { UserId: 1 } : { UserId: { in: [7] } },
        scope === 'self' ? { UserId: 1 } : { UserId: { in: [7] } },
      ]);
    },
  );
  it.each(['merchant', 'unknown'])(
    'rejects %s scope before reading messages',
    async (scope) => {
      const { repository, tx } = setup([role(scope)]);
      await expect(
        repository.readContent(1, id, { reason: 'support', traceId: 'trace' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.aiConversation.findFirst).not.toHaveBeenCalled();
      expect(tx.operationLog.create).not.toHaveBeenCalled();
    },
  );
  it('rejects conflicting multi-role scopes and missing content grants', async () => {
    for (const roles of [
      [role('all'), role('self')],
      [role('all', grants.slice(0, 2))],
    ]) {
      const { repository, tx } = setup(roles);
      await expect(
        repository.readContent(1, id, { reason: 'support', traceId: 'trace' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.aiConversation.findFirst).not.toHaveBeenCalled();
    }
  });
  it('returns 404 for absent or out-of-scope targets without an audit success', async () => {
    const { repository, tx } = setup();
    tx.aiConversation.findFirst.mockResolvedValueOnce(null);
    await expect(
      repository.readContent(1, id, { reason: 'support', traceId: 'trace' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.operationLog.create).not.toHaveBeenCalled();
  });
  it('never returns messages if the audit insert fails', async () => {
    const { repository, tx } = setup();
    tx.operationLog.create.mockRejectedValue(new Error('audit unavailable'));
    await expect(
      repository.readContent(1, id, { reason: 'support', traceId: 'trace' }),
    ).rejects.toThrow('audit unavailable');
  });
  it('audits only reason, owner and target, and serializes bigint message ids without loss', async () => {
    const { repository, tx } = setup();
    const result = await repository.readContent(1, id, {
      reason: 'support',
      traceId: 'trace',
    });
    expect(result.messages[0]?.messageId).toBe('9007199254740993');
    const audit = tx.operationLog.create.mock.calls[0]![0].data;
    expect(audit).toMatchObject({
      ActionKey: 'ai:conversation:read-content',
      TargetId: id,
      Reason: 'support',
      Metadata: { userId: 7 },
    });
    expect(JSON.stringify(audit)).not.toContain('secret');
  });
  it('validates reasons, ranges and pagination before the repository', async () => {
    const { repository } = setup();
    const service = new AuditAiConversations(repository);
    expect(() =>
      service.readContent(1, id, { reason: '   ', traceId: 'trace' }),
    ).toThrow();
    await expect(
      service.list(1, { page: 2147483647, pageSize: 100 }),
    ).rejects.toThrow();
    await expect(
      service.list(1, {
        page: 1,
        pageSize: 20,
        fromTime: '2026-11-02T00:00:00Z',
        toTime: '2026-11-01T00:00:00Z',
      }),
    ).rejects.toThrow();
  });
});
