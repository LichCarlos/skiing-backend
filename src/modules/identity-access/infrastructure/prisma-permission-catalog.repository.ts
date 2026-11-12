import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import {
  buildPermissionCatalog,
  permissionSource,
  registeredApiPermissions,
  type PermissionCatalogAuditContext,
  type PermissionCatalogInput,
  type PermissionCatalogPatch,
  type PermissionCatalogRecord,
  type PermissionCatalogRow,
} from '../domain/permission-catalog.js';
import type { PermissionCatalogRepository } from '../application/ports/permission-catalog-repository.js';
import { ManagementWriteAuthorizationError } from '../domain/management-write-authorization.js';
import { readManagementWriteActor } from './read-management-write-actor.js';

@Injectable()
export class PrismaPermissionCatalogRepository implements PermissionCatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  private async write<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (error instanceof ManagementWriteAuthorizationError)
        throw new ForbiddenException(error.message);
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002')
          throw new ConflictException('Permission key already exists');
        if (error.code === 'P2034')
          throw new ConflictException(
            'Permission catalog changed; reload and retry',
          );
      }
      throw error;
    }
  }

  async findTree(): Promise<PermissionCatalogRecord[]> {
    const rows = await this.prisma.permission.findMany({
      orderBy: [
        { ParentId: 'asc' },
        { SortOrder: 'asc' },
        { PermissionId: 'asc' },
      ],
      select: permissionSelect,
    });
    return buildPermissionCatalog(rows.map(mapRow));
  }

  async create(input: {
    permission: PermissionCatalogInput;
    audit: PermissionCatalogAuditContext;
  }): Promise<PermissionCatalogRecord> {
    return this.write(async (tx) => {
      const actor = await readManagementWriteActor(
        tx,
        input.audit.actorUserId,
        'system:permission:create',
      );
      await assertParent(
        tx,
        input.permission.parentId,
        input.permission.permissionType,
      );
      const row = await tx.permission.create({
        data: {
          ParentId: input.permission.parentId,
          PermissionName: input.permission.permissionName,
          PermissionType: input.permission.permissionType,
          PermissionKey: input.permission.permissionKey,
          Route: input.permission.route,
          Icon: input.permission.icon,
          SortOrder: input.permission.sortOrder,
          Visible: input.permission.visible,
        },
        select: permissionSelect,
      });
      const after = mapRow(row);
      await writeAudit(tx, actor, input.audit, {
        action: 'system:permission:create',
        targetId: String(row.PermissionId),
        after,
      });
      return {
        ...after,
        permissionType:
          after.permissionType as PermissionCatalogRecord['permissionType'],
        source: permissionSource(after.permissionKey),
        status: after.status as PermissionCatalogRecord['status'],
        children: [],
      };
    });
  }

  async update(input: {
    permissionId: number;
    patch: PermissionCatalogPatch;
    audit: PermissionCatalogAuditContext;
  }): Promise<PermissionCatalogRecord | null> {
    return this.write(async (tx) => {
      const actor = await readManagementWriteActor(
        tx,
        input.audit.actorUserId,
        'system:permission:update',
      );
      const current = await tx.permission.findUnique({
        where: { PermissionId: input.permissionId },
        select: permissionSelect,
      });
      if (!current) return null;
      const currentRow = mapRow(current);
      const source = permissionSource(current.PermissionKey);
      if (current.PermissionType === 'api')
        throw new ConflictException('API permissions are registry managed');
      if (
        current.PermissionType === 'menu' &&
        input.patch.route &&
        !input.patch.route.startsWith('/')
      )
        throw new UnprocessableEntityException('Menu route must be absolute');
      const parentId =
        input.patch.parentId !== undefined
          ? input.patch.parentId
          : current.ParentId;
      if (input.patch.parentId !== undefined || current.ParentId !== null)
        await assertParent(
          tx,
          parentId,
          current.PermissionType as 'directory' | 'menu' | 'button',
          input.permissionId,
        );
      if (input.patch.status === 'disabled')
        await assertCanDisable(
          tx,
          input.permissionId,
          source,
          current.PermissionType,
        );
      const row = await tx.permission.update({
        where: { PermissionId: input.permissionId },
        data: {
          ...(input.patch.parentId !== undefined
            ? { ParentId: input.patch.parentId }
            : {}),
          ...(input.patch.permissionName !== undefined
            ? { PermissionName: input.patch.permissionName }
            : {}),
          ...(input.patch.route !== undefined
            ? { Route: input.patch.route }
            : {}),
          ...(input.patch.icon !== undefined ? { Icon: input.patch.icon } : {}),
          ...(input.patch.sortOrder !== undefined
            ? { SortOrder: input.patch.sortOrder }
            : {}),
          ...(input.patch.visible !== undefined
            ? { Visible: input.patch.visible }
            : {}),
          ...(input.patch.status !== undefined
            ? { Status: input.patch.status }
            : {}),
        },
        select: permissionSelect,
      });
      const after = mapRow(row);
      await writeAudit(tx, actor, input.audit, {
        action: 'system:permission:update',
        targetId: String(row.PermissionId),
        before: currentRow,
        after,
      });
      return {
        ...after,
        permissionType:
          after.permissionType as PermissionCatalogRecord['permissionType'],
        source: permissionSource(after.permissionKey),
        status: after.status as PermissionCatalogRecord['status'],
        children: [],
      };
    });
  }

  async disable(input: {
    permissionId: number;
    audit: PermissionCatalogAuditContext;
  }): Promise<'disabled' | 'missing' | 'protected' | 'in-use'> {
    return this.write(async (tx) => {
      const actor = await readManagementWriteActor(
        tx,
        input.audit.actorUserId,
        'system:permission:delete',
      );
      const current = await tx.permission.findUnique({
        where: { PermissionId: input.permissionId },
        select: permissionSelect,
      });
      if (!current) return 'missing';
      const source = permissionSource(current.PermissionKey);
      if (
        source !== 'custom' ||
        (current.PermissionType !== 'menu' &&
          current.PermissionType !== 'button')
      )
        return 'protected';
      const children = await tx.permission.count({
        where: { ParentId: input.permissionId },
      });
      const references = await tx.rolePermission.count({
        where: { PermissionId: input.permissionId },
      });
      if (children > 0 || references > 0) return 'in-use';
      if (current.Status === 'disabled') return 'disabled';
      await tx.permission.update({
        where: { PermissionId: input.permissionId },
        data: { Status: 'disabled' },
      });
      await writeAudit(tx, actor, input.audit, {
        action: 'system:permission:delete',
        targetId: String(input.permissionId),
        before: mapRow(current),
        after: { ...mapRow(current), status: 'disabled' },
      });
      return 'disabled';
    });
  }

  async sync(input: { audit: PermissionCatalogAuditContext }) {
    return this.write(async (tx) => {
      const actor = await readManagementWriteActor(
        tx,
        input.audit.actorUserId,
        'system:permission:update',
        true,
      );
      const definitions = registeredApiPermissions();
      const rows = await tx.permission.findMany({ select: permissionSelect });
      validateSyncCatalog(rows.map(mapRow));
      const byKey = new Map(rows.map((row) => [row.PermissionKey, row]));
      for (const definition of definitions) {
        const existing = byKey.get(definition.key);
        if (existing && existing.PermissionType !== 'api')
          throw new ConflictException(
            `Permission type conflicts with API registry: ${definition.key}`,
          );
        const parent = definition.parentKey
          ? byKey.get(definition.parentKey)
          : null;
        if (
          definition.parentKey &&
          (!parent ||
            parent.Status !== 'active' ||
            parent.PermissionType !== 'menu')
        )
          throw new ConflictException(
            `Permission parent is invalid: ${definition.parentKey}`,
          );
      }
      const knownKeys = definitions.map(({ key }) => key);
      let created = 0;
      let updated = 0;
      for (const definition of definitions) {
        const parent = definition.parentKey
          ? byKey.get(definition.parentKey)
          : null;
        const existing = byKey.get(definition.key);
        await tx.permission.upsert({
          where: { PermissionKey: definition.key },
          create: {
            PermissionKey: definition.key,
            PermissionName: definition.name,
            PermissionType: definition.type,
            ParentId: parent?.PermissionId ?? null,
            Route: definition.route ?? null,
            SortOrder: definition.sortOrder,
            Status: 'active',
          },
          update: {
            PermissionName: definition.name,
            PermissionType: definition.type,
            ParentId: parent?.PermissionId ?? null,
            Route: definition.route ?? null,
            SortOrder: definition.sortOrder,
            Status: 'active',
          },
        });
        if (existing) updated += 1;
        else created += 1;
      }
      const retired = await tx.permission.findMany({
        where: {
          PermissionType: 'api',
          Status: 'active',
          PermissionKey: { notIn: knownKeys },
        },
        select: { PermissionId: true, PermissionKey: true },
      });
      if (retired.length) {
        await tx.permission.updateMany({
          where: {
            PermissionId: {
              in: retired.map(({ PermissionId }) => PermissionId),
            },
          },
          data: { Status: 'disabled' },
        });
      }
      await writeAudit(tx, actor, input.audit, {
        action: 'system:permission:sync',
        targetId: 'registry',
        after: { created, updated, disabled: retired.length },
      });
      return { created, updated, disabled: retired.length };
    });
  }
}

const permissionSelect = {
  PermissionId: true,
  ParentId: true,
  PermissionKey: true,
  PermissionName: true,
  PermissionType: true,
  Route: true,
  Icon: true,
  SortOrder: true,
  Visible: true,
  Status: true,
} as const;

function validateSyncCatalog(rows: PermissionCatalogRow[]) {
  try {
    buildPermissionCatalog(rows);
  } catch {
    throw new ConflictException('Permission hierarchy is invalid');
  }
  const byId = new Map(rows.map((row) => [row.permissionId, row]));
  for (const row of rows) {
    if (row.parentId === null) {
      if (row.permissionType !== 'directory' && row.permissionType !== 'api')
        throw new ConflictException('Permission root type is invalid');
      continue;
    }
    const parent = byId.get(row.parentId)!;
    const expectedType = row.permissionType === 'menu' ? 'directory' : 'menu';
    if (
      row.permissionType === 'directory' ||
      parent.permissionType !== expectedType ||
      parent.status !== 'active'
    )
      throw new ConflictException(
        'Permission parent type or status is invalid',
      );
  }
}

function mapRow(row: {
  PermissionId: number;
  ParentId: number | null;
  PermissionKey: string;
  PermissionName: string;
  PermissionType: string;
  Route: string | null;
  Icon: string | null;
  SortOrder: number;
  Visible: boolean;
  Status: string;
}): PermissionCatalogRow {
  return {
    permissionId: row.PermissionId,
    parentId: row.ParentId,
    permissionKey: row.PermissionKey,
    permissionName: row.PermissionName,
    permissionType: row.PermissionType,
    route: row.Route,
    icon: row.Icon,
    sortOrder: row.SortOrder,
    visible: row.Visible,
    status: row.Status,
  };
}

async function assertParent(
  tx: Prisma.TransactionClient,
  parentId: number | null,
  childType: 'directory' | 'menu' | 'button',
  selfId?: number,
) {
  if (parentId === null) {
    if (childType !== 'directory')
      throw new ConflictException('Only directory nodes may be roots');
    return;
  }
  if (parentId === selfId)
    throw new ConflictException('Permission cannot be its own parent');
  const parent = await tx.permission.findUnique({
    where: { PermissionId: parentId },
    select: { PermissionType: true, Status: true },
  });
  const expectedParent = childType === 'menu' ? 'directory' : 'menu';
  if (
    !parent ||
    parent.Status !== 'active' ||
    (childType !== 'directory' && parent.PermissionType !== expectedParent) ||
    childType === 'directory'
  )
    throw new ConflictException('Permission parent type is invalid');
  if (selfId !== undefined) {
    const ancestors = new Set<number>();
    let cursor: number | null = parentId;
    while (cursor !== null) {
      if (cursor === selfId || ancestors.has(cursor))
        throw new ConflictException(
          'Permission hierarchy cannot contain a cycle',
        );
      ancestors.add(cursor);
      const ancestor: { ParentId: number | null } | null =
        await tx.permission.findUnique({
          where: { PermissionId: cursor },
          select: { ParentId: true },
        });
      cursor = ancestor?.ParentId ?? null;
    }
  }
}

async function assertCanDisable(
  tx: Prisma.TransactionClient,
  permissionId: number,
  source: 'code' | 'custom',
  permissionType: string,
) {
  if (
    source !== 'custom' ||
    (permissionType !== 'menu' && permissionType !== 'button')
  )
    throw new ConflictException('Permission cannot be disabled manually');
  const [children, references] = await Promise.all([
    tx.permission.count({ where: { ParentId: permissionId } }),
    tx.rolePermission.count({ where: { PermissionId: permissionId } }),
  ]);
  if (children || references)
    throw new ConflictException('Permission has children or role references');
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  actor: { account: string },
  audit: PermissionCatalogAuditContext,
  input: {
    action: string;
    targetId: string;
    before?: unknown;
    after: unknown;
  },
) {
  await tx.operationLog.create({
    data: {
      ActorUserId: audit.actorUserId,
      ActorAccountSnapshot: actor.account,
      ActionKey: input.action,
      ResourceKey: 'system:permission',
      TargetType: 'Permission',
      TargetId: input.targetId,
      Result: 'success',
      TraceId: audit.traceId,
      ClientIp: audit.clientIp,
      UserAgent: audit.userAgent,
      Metadata: {
        ...(input.before ? { before: input.before } : {}),
        after: input.after,
      } as Prisma.InputJsonObject,
    },
  });
}
