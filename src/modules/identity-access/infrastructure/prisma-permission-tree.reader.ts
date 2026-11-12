import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { PermissionTreeReader } from '../application/ports/permission-tree-reader.js';
import type { PermissionTreeRecord } from '../domain/permission-tree.js';

@Injectable()
export class PrismaPermissionTreeReader implements PermissionTreeReader {
  constructor(private readonly prisma: PrismaService) {}

  async findActivePermissions(): Promise<readonly PermissionTreeRecord[]> {
    return this.prisma.permission
      .findMany({
        where: { Status: 'active' },
        orderBy: [
          { ParentId: 'asc' },
          { SortOrder: 'asc' },
          { PermissionId: 'asc' },
        ],
        select: {
          PermissionId: true,
          ParentId: true,
          PermissionKey: true,
          PermissionName: true,
          PermissionType: true,
          Route: true,
          Icon: true,
          SortOrder: true,
        },
      })
      .then((records) =>
        records.map((record) => ({
          permissionId: record.PermissionId,
          parentId: record.ParentId,
          permissionKey: record.PermissionKey,
          permissionName: record.PermissionName,
          permissionType: record.PermissionType,
          route: record.Route,
          icon: record.Icon,
          sortOrder: record.SortOrder,
        })),
      );
  }
}
