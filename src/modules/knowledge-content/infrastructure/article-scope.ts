import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  resolveArticleAccess,
  type ArticleAccess,
} from '../domain/article-scope.js';
export function articleWhere(
  access: ArticleAccess,
  id?: number,
): Prisma.ArticleWhereInput {
  if (!resolveArticleAccess(access))
    throw new ForbiddenException('Invalid article scope');
  return {
    DeletedAt: null,
    ...(access.kind === 'self' ? { AuthorId: access.userId } : {}),
    ...(access.kind === 'selected'
      ? { ArticleId: { in: [...access.ids] } }
      : {}),
    ...(id === undefined ? {} : { AND: [{ ArticleId: id }] }),
  };
}
