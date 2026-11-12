import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { ResolveAuthorizationPrincipal } from '../../identity-access/application/resolve-authorization-principal.js';
import { PrismaAuthorizationPrincipalReader } from '../../identity-access/infrastructure/prisma-authorization-principal-reader.js';
import { scopeWhere } from '../../identity-access/infrastructure/prisma-managed-user.repository.js';
import {
  hasPermission,
  mayEnterManagementPortal,
  resolveDataScope,
  type AuthorizationPrincipal,
  type ResolvedDataScope,
} from '../../identity-access/domain/authorization.js';
import { articleWhere } from '../../knowledge-content/infrastructure/article-scope.js';
import { resolveArticleAccess } from '../../knowledge-content/domain/article-scope.js';
import { permitsGlobalResortManagement } from '../../resort-management/domain/resort-management-scope.js';
import { merchantResortWhere } from '../../resort-management/infrastructure/merchant-resort-scope.js';
import type {
  DashboardReader,
  DashboardSummary,
} from '../application/ports/dashboard-reader.js';

@Injectable()
export class PrismaDashboardReader implements DashboardReader {
  constructor(private readonly prisma: PrismaService) {}
  summarize(actorUserId: number): Promise<DashboardSummary> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const principal = await new ResolveAuthorizationPrincipal(
          new PrismaAuthorizationPrincipalReader(tx),
        ).execute(actorUserId);
        if (!principal || !mayEnterManagementPortal(principal))
          throw new ForbiddenException('Management access required');
        const has = (key: string) => hasPermission(principal, key);
        // Resolve only the selected branches, before querying any business panel.
        const userWhere = has('system:user:list')
          ? scopeWhere(requiredScope(principal, 'system:user:list', 'user'))
          : null;
        let resortsWhere: Prisma.SkiResortWhereInput | null = null;
        if (has('content:resort:list-all')) {
          const scope = requiredScope(
            principal,
            'content:resort:list-all',
            'resort',
          );
          if (!permitsGlobalResortManagement(scope))
            throw new ForbiddenException('Global resort scope must be all');
          resortsWhere = { DeletedAt: null };
        } else if (
          has('resort:merchant:list') &&
          principal.merchantId !== null
        ) {
          resortsWhere = merchantWhere(principal, 'resort:merchant:list');
        }
        let articlesWhere: Prisma.ArticleWhereInput | null = null;
        if (has('content:article:manage')) {
          const access = resolveArticleAccess(
            requiredScope(principal, 'content:article:manage', 'article'),
          );
          if (!access) throw new ForbiddenException('Invalid article scope');
          articlesWhere = articleWhere(access);
        }
        // These panels are global by the existing moderation/RAG contract.
        const dynamics = has('content:dynamic:moderate');
        if (dynamics)
          requiredScope(
            principal,
            'content:dynamic:moderate',
            'content:dynamic:moderate',
          );
        const adminCandidate = principal.roles.some(
          (r) => r.active && r.roleKey === 'system_admin',
        );
        const needsProtectedIdentity =
          adminCandidate &&
          (has('ai:knowledge:list') || has('revenue:system:summary'));
        const protectedAdmin =
          needsProtectedIdentity &&
          Boolean(
            await tx.user.findFirst({
              where: {
                UserId: actorUserId,
                Status: 'active',
                UserRoles: {
                  some: {
                    Role: {
                      RoleKey: 'system_admin',
                      SystemRoleCode: 'system_admin',
                      Status: 'active',
                    },
                  },
                },
              },
              select: { UserId: true },
            }),
          );
        const globalRevenue = protectedAdmin && has('revenue:system:summary');
        const revenueWhere: Prisma.SkiResortWhereInput | null = globalRevenue
          ? { DeletedAt: null }
          : has('revenue:merchant:list') && principal.merchantId !== null
            ? merchantWhere(principal, 'revenue:merchant:list')
            : null;
        const result: DashboardSummary = {
          generatedAt: new Date().toISOString(),
          users: null,
          merchants: null,
          resorts: null,
          articles: null,
          dynamics: null,
          rag: null,
          revenue: null,
        };
        if (userWhere) {
          const rows = await tx.user.groupBy({
            by: ['Status'],
            where: userWhere,
            _count: { _all: true },
          });
          result.users = counts(rows, {
            active: 'active',
            disabled: 'disabled',
          });
          const merchantRows = await tx.merchantProfile.groupBy({
            by: ['Status'],
            where: { User: { is: userWhere } },
            _count: { _all: true },
          });
          result.merchants = counts(merchantRows, {
            active: 'active',
            disabled: 'disabled',
          });
        }
        if (resortsWhere) {
          const rows = await tx.skiResort.groupBy({
            by: ['Status'],
            where: resortsWhere,
            _count: { _all: true },
          });
          result.resorts = counts(rows, {
            draft: 'draft',
            pendingReview: 'pending_review',
            published: 'published',
            offline: 'offline',
          });
        }
        if (articlesWhere) {
          const rows = await tx.article.groupBy({
            by: ['Status'],
            where: articlesWhere,
            _count: { _all: true },
          });
          result.articles = counts(rows, {
            draft: 'draft',
            published: 'published',
            withdrawn: 'withdrawn',
          });
        }
        if (dynamics) {
          const rows = await tx.dynamic.groupBy({
            by: ['Status'],
            where: { DeletedAt: null },
            _count: { _all: true },
          });
          result.dynamics = counts(rows, {
            pending: 'pending',
            published: 'published',
            hidden: 'hidden',
          });
        }
        if (protectedAdmin && has('ai:knowledge:list'))
          result.rag = {
            failed: await tx.ragDocument.count({ where: { Status: 'failed' } }),
          };
        if (revenueWhere) {
          const sum = await tx.resortRevenueRecord.aggregate({
            where: { Resort: { is: revenueWhere } },
            _sum: { RevenueAmount: true },
          });
          result.revenue = {
            amount: (sum._sum.RevenueAmount ?? new Prisma.Decimal(0)).toFixed(
              2,
            ),
            currency: 'CNY',
            period: 'all-time',
            scope: globalRevenue ? 'all' : 'merchant',
          };
        }
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
function requiredScope(
  principal: AuthorizationPrincipal,
  permission: string,
  resource: string,
): ResolvedDataScope {
  const scope = resolveDataScope(principal, permission, resource);
  const ids =
    scope?.kind === 'selected'
      ? scope.ids
      : scope?.kind === 'self'
        ? [scope.userId]
        : scope?.kind === 'merchant'
          ? [scope.merchantId]
          : [];
  if (
    !scope ||
    !ids.every((id) => Number.isInteger(id) && id > 0 && id <= 2147483647)
  )
    throw new ForbiddenException('Invalid or conflicting dashboard data scope');
  return scope;
}
function merchantWhere(principal: AuthorizationPrincipal, permission: string) {
  return merchantResortWhere({
    userId: principal.userId,
    merchantId: principal.merchantId,
    scope: requiredScope(principal, permission, 'resort'),
  });
}
function counts<T extends Record<string, string>>(
  rows: { Status: string; _count: { _all: number } }[],
  mapping: T,
): { total: number } & { [K in keyof T]: number } {
  const result = Object.fromEntries(
    Object.entries(mapping).map(([key, value]) => [
      key,
      rows.find((row) => row.Status === value)?._count._all ?? 0,
    ]),
  );
  return {
    total: Object.values(result).reduce((sum, count) => sum + count, 0),
    ...result,
  } as { total: number } & { [K in keyof T]: number };
}
