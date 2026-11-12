import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import {
  buildDictionaryTree,
  validateDictionaryItemParent,
  type DictionaryAuditContext,
  type DictionaryItem,
  type DictionaryItemNode,
  type DictionaryStatus,
  type ManagedDictionary,
} from '../domain/managed-dictionary.js';
import {
  DictionaryParentInvalidError,
  DictionaryValueInUseError,
} from '../application/dictionary-management-errors.js';
import type {
  DictionaryItemInput,
  DictionaryItemPatch,
  DictionaryTypeFilter,
  DictionaryTypePatch,
  ManagedDictionaryRepository,
} from '../application/ports/managed-dictionary-repository.js';
import { appendOutboxEvent } from '../../integration-events/infrastructure/append-outbox-event.js';
import { readManagementWriteActor } from '../../identity-access/infrastructure/read-management-write-actor.js';

@Injectable()
export class PrismaManagedDictionaryRepository implements ManagedDictionaryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listTypes(filter: DictionaryTypeFilter) {
    const where: Prisma.DictionaryTypeWhereInput = {
      ...(filter.groupKey ? { GroupKey: filter.groupKey } : {}),
      ...(filter.status ? { Status: filter.status } : {}),
    };
    const [records, total] = await this.prisma.$transaction([
      this.prisma.dictionaryType.findMany({
        where,
        include: { Items: true },
        orderBy: [{ GroupKey: 'asc' }, { DictType: 'asc' }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.dictionaryType.count({ where }),
    ]);
    return { items: records.map(mapDictionaryType), total };
  }

  async findType(dictType: string): Promise<ManagedDictionary | null> {
    const record = await this.prisma.dictionaryType.findUnique({
      where: { DictType: dictType },
      include: { Items: true },
    });
    return record ? mapDictionaryType(record) : null;
  }

  async createType(input: {
    dictType: string;
    dictName: string;
    groupKey: string;
    publiclyReadable: boolean;
    audit: DictionaryAuditContext;
  }): Promise<ManagedDictionary> {
    return this.prisma.$transaction(
      async (transaction) => {
        const actor = await readManagementWriteActor(
          transaction,
          input.audit.actorUserId,
          'system:dict:create',
        );
        const record = await transaction.dictionaryType.create({
          data: {
            DictType: input.dictType,
            DictName: input.dictName,
            GroupKey: input.groupKey,
            PubliclyReadable: input.publiclyReadable,
          },
          include: { Items: true },
        });
        const result = mapDictionaryType(record);
        await writeAudit(transaction, actor, input.audit, {
          actionKey: 'system:dict:create',
          resourceKey: 'system:dict',
          targetType: 'DictionaryType',
          targetId: input.dictType,
          after: result,
        });
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async updateType(input: {
    dictType: string;
    patch: DictionaryTypePatch;
    audit: DictionaryAuditContext;
  }): Promise<ManagedDictionary | null> {
    return this.prisma.$transaction(
      async (transaction) => {
        const actor = await readManagementWriteActor(
          transaction,
          input.audit.actorUserId,
          'system:dict:update',
        );
        const current = await transaction.dictionaryType.findUnique({
          where: { DictType: input.dictType },
          include: { Items: true },
        });
        if (!current) return null;
        const record = await transaction.dictionaryType.update({
          where: { DictType: input.dictType },
          data: {
            ...(input.patch.dictName !== undefined
              ? { DictName: input.patch.dictName }
              : {}),
            ...(input.patch.groupKey !== undefined
              ? { GroupKey: input.patch.groupKey }
              : {}),
            ...(input.patch.status !== undefined
              ? { Status: input.patch.status }
              : {}),
            ...(input.patch.publiclyReadable !== undefined
              ? { PubliclyReadable: input.patch.publiclyReadable }
              : {}),
          },
          include: { Items: true },
        });
        const before = mapDictionaryType(current);
        const after = mapDictionaryType(record);
        await writeAudit(transaction, actor, input.audit, {
          actionKey: 'system:dict:update',
          resourceKey: 'system:dict',
          targetType: 'DictionaryType',
          targetId: input.dictType,
          before,
          after,
        });
        for (const item of current.Items) {
          await appendDictionaryEvent(transaction, input.dictType, item.ItemId);
        }
        return after;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async disableType(input: {
    dictType: string;
    audit: DictionaryAuditContext;
  }): Promise<boolean> {
    return this.prisma.$transaction(
      async (transaction) => {
        const actor = await readManagementWriteActor(
          transaction,
          input.audit.actorUserId,
          'system:dict:delete',
        );
        const current = await transaction.dictionaryType.findUnique({
          where: { DictType: input.dictType },
          include: { Items: true },
        });
        if (!current) return false;
        const record = await transaction.dictionaryType.update({
          where: { DictType: input.dictType },
          data: { Status: 'disabled' },
          include: { Items: true },
        });
        await writeAudit(transaction, actor, input.audit, {
          actionKey: 'system:dict:delete',
          resourceKey: 'system:dict',
          targetType: 'DictionaryType',
          targetId: input.dictType,
          before: mapDictionaryType(current),
          after: mapDictionaryType(record),
        });
        for (const item of record.Items) {
          await appendDictionaryEvent(transaction, input.dictType, item.ItemId);
        }
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async createItem(input: {
    dictType: string;
    item: DictionaryItemInput;
    audit: DictionaryAuditContext;
  }): Promise<DictionaryItem | null> {
    return this.prisma.$transaction(
      async (transaction) => {
        const actor = await readManagementWriteActor(
          transaction,
          input.audit.actorUserId,
          'system:dict:create',
        );
        const type = await transaction.dictionaryType.findUnique({
          where: { DictType: input.dictType },
          select: { Status: true },
        });
        if (!type) return null;
        if (type.Status !== 'active')
          throw new DictionaryParentInvalidError(
            'Cannot add an item to a disabled dictionary',
          );
        await assertParent(
          transaction,
          input.dictType,
          null,
          input.item.parentId,
        );
        const record = await transaction.dictionaryItem.create({
          data: {
            DictType: input.dictType,
            Label: input.item.label,
            Value: input.item.value,
            ParentId: input.item.parentId,
            Color: input.item.color,
            SortOrder: input.item.sortOrder,
            IsDefault: input.item.isDefault,
          },
        });
        const after = mapDictionaryItem(record);
        await writeAudit(transaction, actor, input.audit, {
          actionKey: 'system:dict:item:create',
          resourceKey: 'system:dict',
          targetType: 'DictionaryItem',
          targetId: String(record.ItemId),
          after,
        });
        await appendDictionaryEvent(transaction, input.dictType, record.ItemId);
        return after;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async updateItem(input: {
    dictType: string;
    itemId: number;
    patch: DictionaryItemPatch;
    audit: DictionaryAuditContext;
  }): Promise<DictionaryItem | null> {
    return this.prisma.$transaction(
      async (transaction) => {
        const actor = await readManagementWriteActor(
          transaction,
          input.audit.actorUserId,
          'system:dict:update',
        );
        const current = await transaction.dictionaryItem.findFirst({
          where: { DictType: input.dictType, ItemId: input.itemId },
        });
        if (!current) return null;
        if (input.patch.parentId !== undefined)
          await assertParent(
            transaction,
            input.dictType,
            input.itemId,
            input.patch.parentId,
          );
        if (
          input.patch.value !== undefined &&
          input.patch.value !== current.Value
        ) {
          const [articleReferences, resortReferences] = await Promise.all([
            transaction.article.count({
              where: {
                CategoryDictType: input.dictType,
                CategoryValue: current.Value,
              },
            }),
            transaction.resortFitTag.count({
              where: { DictType: input.dictType, ItemId: input.itemId },
            }),
          ]);
          const customFieldReference = await hasCustomFieldReference(
            transaction,
            input.dictType,
            current.Value,
          );
          if (
            articleReferences > 0 ||
            resortReferences > 0 ||
            customFieldReference
          )
            throw new DictionaryValueInUseError(
              'A referenced dictionary value cannot be renamed',
            );
        }
        const record = await transaction.dictionaryItem.update({
          where: { ItemId: input.itemId },
          data: {
            ...(input.patch.label !== undefined
              ? { Label: input.patch.label }
              : {}),
            ...(input.patch.value !== undefined
              ? { Value: input.patch.value }
              : {}),
            ...(input.patch.parentId !== undefined
              ? { ParentId: input.patch.parentId }
              : {}),
            ...(input.patch.color !== undefined
              ? { Color: input.patch.color }
              : {}),
            ...(input.patch.sortOrder !== undefined
              ? { SortOrder: input.patch.sortOrder }
              : {}),
            ...(input.patch.isDefault !== undefined
              ? { IsDefault: input.patch.isDefault }
              : {}),
            ...(input.patch.status !== undefined
              ? { Status: input.patch.status }
              : {}),
          },
        });
        const before = mapDictionaryItem(current);
        const after = mapDictionaryItem(record);
        await writeAudit(transaction, actor, input.audit, {
          actionKey: 'system:dict:item:update',
          resourceKey: 'system:dict',
          targetType: 'DictionaryItem',
          targetId: String(input.itemId),
          before,
          after,
        });
        await appendDictionarySubtreeEvents(
          transaction,
          input.dictType,
          record.ItemId,
          current.Value,
        );
        return after;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async disableItem(input: {
    dictType: string;
    itemId: number;
    audit: DictionaryAuditContext;
  }): Promise<boolean> {
    return this.prisma.$transaction(
      async (transaction) => {
        const actor = await readManagementWriteActor(
          transaction,
          input.audit.actorUserId,
          'system:dict:delete',
        );
        const current = await transaction.dictionaryItem.findFirst({
          where: { DictType: input.dictType, ItemId: input.itemId },
        });
        if (!current) return false;
        const record = await transaction.dictionaryItem.update({
          where: { ItemId: input.itemId },
          data: { Status: 'disabled' },
        });
        await writeAudit(transaction, actor, input.audit, {
          actionKey: 'system:dict:item:delete',
          resourceKey: 'system:dict',
          targetType: 'DictionaryItem',
          targetId: String(input.itemId),
          before: mapDictionaryItem(current),
          after: mapDictionaryItem(record),
        });
        await appendDictionarySubtreeEvents(
          transaction,
          input.dictType,
          record.ItemId,
        );
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}

async function appendDictionaryEvent(
  transaction: Prisma.TransactionClient,
  dictType: string,
  itemId: number,
  previousValue?: string,
) {
  await appendOutboxEvent(transaction, {
    eventType: 'dictionary.changed.v1',
    aggregateType: 'DictionaryItem',
    aggregateId: `${dictType}:${itemId}`,
    payload: {
      dictType,
      itemId,
      ...(previousValue !== undefined ? { previousValue } : {}),
    },
  });
}

async function hasCustomFieldReference(
  transaction: Prisma.TransactionClient,
  dictType: string,
  value: string,
): Promise<boolean> {
  // Disabled definitions and soft-deleted records retain their values and can
  // become active again. Renaming must protect their references as well.
  const definitions = await transaction.customFieldDefinition.findMany({
    where: {
      OptionsDictType: dictType,
      DataType: { in: ['single_select', 'multi_select'] },
    },
    select: { EntityType: true, FieldKey: true, DefaultValue: true },
  });
  for (const definition of definitions) {
    if (
      definition.DefaultValue === value ||
      (Array.isArray(definition.DefaultValue) &&
        definition.DefaultValue.includes(value))
    )
      return true;
    const CustomFields: Prisma.JsonFilter = {
      path: [definition.FieldKey],
      // Check both stored forms so historical data remains protected if its
      // declared selection type has changed.
      equals: value,
    };
    const conditions = [
      { CustomFields },
      {
        CustomFields: { path: [definition.FieldKey], array_contains: [value] },
      },
    ];
    let reference: { exists: boolean } | null = null;
    switch (definition.EntityType) {
      case 'ski_resort':
        reference = await transaction.skiResort
          .findFirst({ where: { OR: conditions }, select: { ResortId: true } })
          .then((row) => (row ? { exists: true } : null));
        break;
      case 'article':
        reference = await transaction.article
          .findFirst({ where: { OR: conditions }, select: { ArticleId: true } })
          .then((row) => (row ? { exists: true } : null));
        break;
      case 'dynamic':
        reference = await transaction.dynamic
          .findFirst({ where: { OR: conditions }, select: { DynamicId: true } })
          .then((row) => (row ? { exists: true } : null));
        break;
      case 'merchant_profile':
        reference = await transaction.merchantProfile
          .findFirst({
            where: { OR: conditions },
            select: { MerchantId: true },
          })
          .then((row) => (row ? { exists: true } : null));
        break;
    }
    if (reference) return true;
  }
  return false;
}

async function appendDictionarySubtreeEvents(
  transaction: Prisma.TransactionClient,
  dictType: string,
  itemId: number,
  previousValue?: string,
): Promise<void> {
  const rows = await transaction.dictionaryItem.findMany({
    where: { DictType: dictType },
    select: { ItemId: true, ParentId: true },
    orderBy: { ItemId: 'asc' },
  });
  const children = new Map<number, number[]>();
  for (const row of rows) {
    if (row.ParentId === null) continue;
    const siblings = children.get(row.ParentId) ?? [];
    siblings.push(row.ItemId);
    children.set(row.ParentId, siblings);
  }
  const queue = [itemId];
  const visited = new Set<number>();
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (visited.has(id)) continue;
    visited.add(id);
    await appendDictionaryEvent(
      transaction,
      dictType,
      id,
      id === itemId ? previousValue : undefined,
    );
    queue.push(...(children.get(id) ?? []));
  }
}

const typeWithItems = Prisma.validator<Prisma.DictionaryTypeDefaultArgs>()({
  include: { Items: true },
});
type TypeRecord = Prisma.DictionaryTypeGetPayload<typeof typeWithItems>;

function mapDictionaryType(record: TypeRecord): ManagedDictionary {
  return {
    dictType: record.DictType,
    dictName: record.DictName,
    groupKey: record.GroupKey,
    status: record.Status as DictionaryStatus,
    publiclyReadable: record.PubliclyReadable,
    items: buildDictionaryTree(record.Items.map(mapDictionaryItemRow)),
  };
}

function mapDictionaryItemRow(record: Prisma.DictionaryItemGetPayload<object>) {
  return {
    itemId: record.ItemId,
    parentId: record.ParentId,
    label: record.Label,
    value: record.Value,
    color: record.Color,
    sortOrder: record.SortOrder,
    isDefault: record.IsDefault,
    status: record.Status as DictionaryStatus,
  };
}

function mapDictionaryItem(
  record: Prisma.DictionaryItemGetPayload<object>,
): DictionaryItem {
  return { ...mapDictionaryItemRow(record), children: [] };
}

async function assertParent(
  transaction: Prisma.TransactionClient,
  dictType: string,
  itemId: number | null,
  parentId: number | null,
): Promise<void> {
  const records = await transaction.dictionaryItem.findMany({
    where: { DictType: dictType },
    select: { ItemId: true, DictType: true, ParentId: true },
  });
  const nodes: DictionaryItemNode[] = records.map((record) => ({
    itemId: record.ItemId,
    dictType: record.DictType,
    parentId: record.ParentId,
  }));
  const issue = validateDictionaryItemParent({
    dictType,
    itemId,
    parentId,
    nodes,
  });
  if (issue) throw new DictionaryParentInvalidError(issue);
}

async function writeAudit(
  transaction: Prisma.TransactionClient,
  actor: { account: string },
  audit: DictionaryAuditContext,
  input: {
    actionKey: string;
    resourceKey: string;
    targetType: string;
    targetId: string;
    before?: unknown;
    after: unknown;
  },
): Promise<void> {
  const metadata = JSON.parse(
    JSON.stringify({
      ...(input.before !== undefined ? { before: input.before } : {}),
      after: input.after,
    }),
  ) as Prisma.InputJsonObject;
  await transaction.operationLog.create({
    data: {
      ActorUserId: audit.actorUserId,
      ActorAccountSnapshot: actor.account,
      ActionKey: input.actionKey,
      ResourceKey: input.resourceKey,
      TargetType: input.targetType,
      TargetId: input.targetId,
      Result: 'success',
      TraceId: audit.traceId,
      ClientIp: audit.clientIp,
      UserAgent: audit.userAgent,
      Metadata: metadata,
    },
  });
}
