import { Prisma } from '@prisma/client';
import type {
  BackfillReader,
  BackfillSource,
} from '../application/rag-backfill.js';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';

// Identifiers are code constants, never interpolated CLI strings.
const sources = {
  resort: { table: Prisma.sql`"SkiResort"`, id: Prisma.sql`"ResortId"` },
  article: { table: Prisma.sql`"Article"`, id: Prisma.sql`"ArticleId"` },
  project_doc: {
    table: Prisma.sql`"ProjectKnowledge"`,
    id: Prisma.sql`"ProjectKnowledgeId"`,
  },
  dynamic: { table: Prisma.sql`"Dynamic"`, id: Prisma.sql`"DynamicId"` },
  dictionary: { table: Prisma.sql`"DictionaryItem"`, id: Prisma.sql`"ItemId"` },
};

export class PrismaRagBackfillReader implements BackfillReader {
  constructor(private readonly prisma: PrismaService) {}
  async upperBound(source: BackfillSource): Promise<number> {
    const { table, id } = sources[source];
    const rows = await this.prisma.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT COALESCE(MAX(${id}), 0)::integer AS id FROM ${table}`,
    );
    return rows[0]!.id;
  }
  async page(
    source: BackfillSource,
    afterId: number,
    upper: number,
    limit: number,
  ): Promise<number[]> {
    const { table, id } = sources[source];
    const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
      SELECT ${id} AS id FROM ${table}
      WHERE ${id} > ${afterId} AND ${id} <= ${upper}
      ORDER BY ${id} ASC LIMIT ${limit}
    `);
    return rows.map(({ id }) => id);
  }
}
