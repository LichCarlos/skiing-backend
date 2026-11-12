import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import {
  BUSINESS_ENTITIES,
  normalizeBusinessQuery,
  type BusinessEntity,
  type BusinessQuery,
  type QueryField,
} from '../domain/business-query.js';
import type {
  BusinessQueryReader,
  BusinessRow,
} from '../application/ports/business-query-reader.js';

const configurations = {
  ski_resort: {
    table: 'SkiResort',
    id: 'ResortId',
    title: 'Name',
    fields: {
      name: ['Name', '名称', 'text'],
      province: ['Province', '省份', 'text'],
      city: ['City', '城市', 'text'],
      district: ['District', '区县', 'text'],
      price: ['Price', '起价（元）', 'integer'],
      rating: ['Rating', '评分', 'decimal'],
      openStatus: ['OpenStatus', '营业状态', 'text'],
    },
  },
  article: {
    table: 'Article',
    id: 'ArticleId',
    title: 'Title',
    fields: {
      title: ['Title', '标题', 'text'],
      category: ['CategoryValue', '分类', 'text'],
      authorName: ['AuthorName', '作者', 'text'],
    },
  },
  dynamic: {
    table: 'Dynamic',
    id: 'DynamicId',
    title: 'Content',
    fields: { content: ['Content', '正文', 'text'] },
  },
} as const;
@Injectable()
export class PrismaBusinessQueryReader implements BusinessQueryReader {
  constructor(private readonly prisma: PrismaService) {}
  fields(entity: BusinessEntity) {
    this.assertEntity(entity);
    return this.prisma.$transaction((tx) => catalog(tx, entity), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }
  query(entity: BusinessEntity, input: BusinessQuery) {
    this.assertEntity(entity);
    return this.prisma.$transaction(
      async (tx) => {
        const fields = await catalog(tx, entity);
        let query: ReturnType<typeof normalizeBusinessQuery>;
        try {
          query = normalizeBusinessQuery(input, fields);
        } catch (error) {
          throw new BadRequestException(
            error instanceof Error ? error.message : 'Invalid query',
          );
        }
        const config = configurations[entity];
        const conditions = [publicPredicate(entity)];
        if (query.keyword)
          conditions.push(
            Prisma.sql`(${Prisma.join(
              fields
                .filter((f) => f.searchable)
                .map(
                  (f) =>
                    Prisma.sql`position(lower(${query.keyword}) in lower(COALESCE(${expression(entity, f)}::text,''))) > 0`,
                ),
              ' OR ',
            )})`,
          );
        for (const filter of query.filters) {
          const field = fields.find((f) => f.key === filter.field)!;
          const expr = expression(entity, field);
          if (filter.op === 'eq')
            conditions.push(Prisma.sql`${expr} = ${filter.value}`);
          if (filter.op === 'gte')
            conditions.push(Prisma.sql`${expr} >= ${filter.value}`);
          if (filter.op === 'lte')
            conditions.push(Prisma.sql`${expr} <= ${filter.value}`);
          if (filter.op === 'contains')
            conditions.push(
              Prisma.sql`position(lower(${String(filter.value)}) in lower(${expr}::text)) > 0`,
            );
          if (filter.op === 'has')
            conditions.push(
              Prisma.sql`(b."CustomFields" -> ${field.key.slice(7)}) @> ${JSON.stringify([filter.value])}::jsonb`,
            );
        }
        const predicate = Prisma.join(conditions, ' AND ');
        const counts = await tx.$queryRaw<{ total: bigint }[]>(
          Prisma.sql`SELECT COUNT(*)::bigint AS total FROM ${identifier(config.table)} b WHERE ${predicate}`,
        );
        const order = query.sort
          ? Prisma.sql`${expression(
              entity,
              fields.find((f) => f.key === query.sort!.field)!,
            )} ${query.sort.direction === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`} NULLS LAST,`
          : Prisma.empty;
        const rows = await tx.$queryRaw<
          { id: number; title: string; values: Record<string, unknown> }[]
        >(
          Prisma.sql`SELECT b.${identifier(config.id)} AS id, left(b.${identifier(config.title)},300) AS title, to_jsonb(b) AS values FROM ${identifier(config.table)} b WHERE ${predicate} ORDER BY ${order} b.${identifier(config.id)} ASC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
        );
        const items: BusinessRow[] = rows.map((row) => ({
          id: row.id,
          title: row.title,
          fields: Object.fromEntries(
            fields
              .filter((f) => f.builtin)
              .map((f) => [
                f.key,
                row.values[
                  (config.fields as Record<string, readonly string[]>)[
                    f.key
                  ]![0]!
                ] ?? null,
              ]),
          ),
          customFields: Object.fromEntries(
            fields
              .filter((f) => !f.builtin)
              .flatMap((f) => {
                const values = row.values.CustomFields as Record<
                  string,
                  unknown
                > | null;
                return values && Object.hasOwn(values, f.key.slice(7))
                  ? [[f.key.slice(7), values[f.key.slice(7)]]]
                  : [];
              }),
          ),
        }));
        return {
          items,
          total: Number(counts[0]?.total ?? 0),
          page: query.page,
          pageSize: query.pageSize,
          asOf: new Date().toISOString(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  private assertEntity(entity: BusinessEntity) {
    if (!BUSINESS_ENTITIES.includes(entity))
      throw new BadRequestException('Unsupported public entity');
  }
}
async function catalog(
  tx: Prisma.TransactionClient,
  entity: BusinessEntity,
): Promise<QueryField[]> {
  const defs = await tx.customFieldDefinition.findMany({
    where: {
      EntityType: entity,
      Status: 'active',
      IsPublic: true,
      Group: { Status: 'active' },
      OR: [
        { OptionsDictType: null },
        { OptionsType: { Status: 'active', PubliclyReadable: true } },
      ],
    },
    include: {
      OptionsType: {
        select: {
          Items: {
            where: { Status: 'active' },
            select: { Value: true, Label: true },
            orderBy: [{ SortOrder: 'asc' }, { ItemId: 'asc' }],
          },
        },
      },
    },
    orderBy: [{ SortOrder: 'asc' }, { FieldKey: 'asc' }],
  });
  return [
    ...Object.entries(configurations[entity].fields).map(
      ([key, [, label, dataType]]) => ({
        key,
        label,
        dataType,
        builtin: true,
        searchable: dataType === 'text',
        filterable: true,
        sortable: true,
      }),
    ),
    ...defs.map((f) => ({
      key: `custom.${f.FieldKey}`,
      label: f.Label,
      dataType: f.DataType,
      searchable: f.Searchable,
      filterable: f.Filterable,
      sortable: f.Sortable,
      options:
        f.OptionsType?.Items.map((i) => ({ value: i.Value, label: i.Label })) ??
        [],
    })),
  ];
}
function expression(entity: BusinessEntity, field: QueryField): Prisma.Sql {
  if (field.builtin)
    return Prisma.sql`b.${identifier((configurations[entity].fields as Record<string, readonly string[]>)[field.key]![0]!)}`;
  const value = Prisma.sql`b."CustomFields" -> ${field.key.slice(7)}`;
  if (['integer', 'decimal'].includes(field.dataType))
    return Prisma.sql`CASE WHEN jsonb_typeof(${value})='number' THEN (b."CustomFields" ->> ${field.key.slice(7)})::numeric ELSE NULL END`;
  if (field.dataType === 'boolean')
    return Prisma.sql`CASE WHEN jsonb_typeof(${value})='boolean' THEN (b."CustomFields" ->> ${field.key.slice(7)})::boolean ELSE NULL END`;
  return Prisma.sql`CASE WHEN jsonb_typeof(${value})='string' THEN b."CustomFields" ->> ${field.key.slice(7)} ELSE NULL END`;
}
// Identifiers only originate from the sealed configuration above. User text is always a bound parameter.
function identifier(value: string): Prisma.Sql {
  return Prisma.raw('"' + value + '"');
}
function publicPredicate(entity: BusinessEntity): Prisma.Sql {
  const base = Prisma.sql`b."Status"='published' AND b."DeletedAt" IS NULL`;
  if (entity === 'article')
    return Prisma.sql`${base} AND b."PublishTime" IS NOT NULL AND EXISTS (SELECT 1 FROM "DictionaryItem" i JOIN "DictionaryType" t ON t."DictType"=i."DictType" WHERE i."DictType"=b."CategoryDictType" AND i."Value"=b."CategoryValue" AND i."Status"='active' AND t."Status"='active' AND t."PubliclyReadable"=true)`;
  if (entity === 'dynamic')
    return Prisma.sql`${base} AND EXISTS (SELECT 1 FROM "User" u WHERE u."UserId"=b."AuthorId" AND u."Status"='active') AND (b."ResortId" IS NULL OR EXISTS (SELECT 1 FROM "SkiResort" r WHERE r."ResortId"=b."ResortId" AND r."Status"='published' AND r."DeletedAt" IS NULL))`;
  return base;
}
