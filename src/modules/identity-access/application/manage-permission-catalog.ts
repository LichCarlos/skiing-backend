import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PERMISSION_CATALOG_REPOSITORY,
  type PermissionCatalogRepository,
} from './ports/permission-catalog-repository.js';
import type {
  PermissionCatalogAuditContext,
  PermissionCatalogPatch,
  PermissionCatalogRecord,
  PermissionStatus,
} from '../domain/permission-catalog.js';

export interface CreatePermissionCatalogInput {
  permissionKey: unknown;
  parentId?: unknown;
  permissionName: unknown;
  permissionType: unknown;
  route?: unknown;
  icon?: unknown;
  sortOrder?: unknown;
  visible?: unknown;
}

export type UpdatePermissionCatalogInput = Partial<{
  parentId: unknown;
  permissionName: unknown;
  route: unknown;
  icon: unknown;
  sortOrder: unknown;
  visible: unknown;
  status: unknown;
}>;

@Injectable()
export class ManagePermissionCatalog {
  constructor(
    @Inject(PERMISSION_CATALOG_REPOSITORY)
    private readonly catalog: PermissionCatalogRepository,
  ) {}

  list() {
    return this.catalog.findTree();
  }

  async detail(permissionId: number): Promise<PermissionCatalogRecord> {
    if (!Number.isSafeInteger(permissionId) || permissionId < 1)
      throw new BadRequestException('permissionId is invalid');
    const pending = [...(await this.catalog.findTree())];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.permissionId === permissionId) return node;
      pending.push(...node.children);
    }
    throw new NotFoundException('Permission not found');
  }

  async create(input: {
    body: CreatePermissionCatalogInput;
    audit: PermissionCatalogAuditContext;
  }) {
    const body = input.body;
    const permissionKey = text(body.permissionKey, 'permissionKey', 100);
    if (!/^custom:[a-z0-9][a-z0-9._:-]{0,92}$/.test(permissionKey))
      throw new UnprocessableEntityException('Invalid custom permission key');
    const permissionType = body.permissionType;
    if (
      permissionType !== 'directory' &&
      permissionType !== 'menu' &&
      permissionType !== 'button'
    )
      throw new UnprocessableEntityException('Invalid permissionType');
    const permissionName = text(body.permissionName, 'permissionName', 100);
    const route = optionalText(body.route, 'route', 200);
    if (permissionType === 'menu' && route && !route.startsWith('/'))
      throw new UnprocessableEntityException('Menu route must be absolute');
    return this.catalog.create({
      permission: {
        permissionKey,
        permissionName,
        permissionType,
        parentId: nullablePositiveInt(body.parentId, 'parentId'),
        route,
        icon: optionalText(body.icon, 'icon', 100),
        sortOrder: integer(
          body.sortOrder === undefined ? 0 : body.sortOrder,
          'sortOrder',
          -100000,
          100000,
        ),
        visible: boolean(
          body.visible === undefined ? true : body.visible,
          'visible',
        ),
      },
      audit: input.audit,
    });
  }

  async update(input: {
    permissionId: number;
    body: UpdatePermissionCatalogInput;
    audit: PermissionCatalogAuditContext;
  }) {
    if (!Number.isSafeInteger(input.permissionId) || input.permissionId < 1)
      throw new BadRequestException('permissionId is invalid');
    const body = input.body;
    const patch: PermissionCatalogPatch = {};
    if (body.parentId !== undefined)
      patch.parentId = nullablePositiveInt(body.parentId, 'parentId');
    if (body.permissionName !== undefined)
      patch.permissionName = text(body.permissionName, 'permissionName', 100);
    if (body.route !== undefined)
      patch.route = optionalText(body.route, 'route', 200);
    if (body.icon !== undefined)
      patch.icon = optionalText(body.icon, 'icon', 100);
    if (body.sortOrder !== undefined)
      patch.sortOrder = integer(body.sortOrder, 'sortOrder', -100000, 100000);
    if (body.visible !== undefined)
      patch.visible = boolean(body.visible, 'visible');
    if (body.status !== undefined) {
      if (body.status !== 'active' && body.status !== 'disabled')
        throw new UnprocessableEntityException('Invalid status');
      patch.status = body.status as PermissionStatus;
    }
    if (!Object.keys(patch).length)
      throw new BadRequestException('At least one mutable field is required');
    const result = await this.catalog.update({
      permissionId: input.permissionId,
      patch,
      audit: input.audit,
    });
    if (!result) throw new NotFoundException('Permission not found');
    return result;
  }

  async disable(input: {
    permissionId: number;
    audit: PermissionCatalogAuditContext;
  }) {
    if (!Number.isSafeInteger(input.permissionId) || input.permissionId < 1)
      throw new BadRequestException('permissionId is invalid');
    const result = await this.catalog.disable(input);
    if (result === 'missing')
      throw new NotFoundException('Permission not found');
    if (result === 'protected')
      throw new ConflictException(
        'Only custom menu/button nodes can be disabled',
      );
    if (result === 'in-use')
      throw new ConflictException('Permission has children or role references');
  }

  sync(input: { audit: PermissionCatalogAuditContext }) {
    return this.catalog.sync(input);
  }
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new UnprocessableEntityException(`Invalid ${name}`);
  return value.trim();
}

function optionalText(
  value: unknown,
  name: string,
  max: number,
): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > max)
    throw new UnprocessableEntityException(`Invalid ${name}`);
  return value.trim() || null;
}

function nullablePositiveInt(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new UnprocessableEntityException(`Invalid ${name}`);
  return parsed;
}

function integer(value: unknown, name: string, min: number, max: number) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw new UnprocessableEntityException(`Invalid ${name}`);
  return value;
}

function boolean(value: unknown, name: string) {
  if (typeof value !== 'boolean')
    throw new UnprocessableEntityException(`Invalid ${name}`);
  return value;
}
