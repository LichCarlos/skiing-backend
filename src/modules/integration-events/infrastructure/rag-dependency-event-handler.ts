import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { IntegrationEvent } from '../domain/integration-event.js';
import { PrismaInboxExecutor } from './prisma-inbox.executor.js';
import { appendOutboxEvent } from './append-outbox-event.js';

const entities = {
  ski_resort: {
    table: 'SkiResort',
    id: 'ResortId',
    event: 'resort.changed.v1',
    key: 'resortId',
  },
  article: {
    table: 'Article',
    id: 'ArticleId',
    event: 'article.changed.v1',
    key: 'articleId',
  },
  dynamic: {
    table: 'Dynamic',
    id: 'DynamicId',
    event: 'dynamic.changed.v1',
    key: 'dynamicId',
  },
} as const;
@Injectable()
export class RagDependencyEventHandler {
  constructor(private readonly inbox: PrismaInboxExecutor) {}
  async handle(event: IntegrationEvent): Promise<boolean> {
    if (event.eventType === 'resort.changed.v1')
      return this.inbox.executeOnce(
        {
          consumerKey: 'rag-resort-dependencies.v1',
          eventId: event.eventId,
          eventType: event.eventType,
        },
        async (tx) => {
          await appendOutboxEvent(tx, {
            eventType: 'rag.dependencies.changed.v1',
            aggregateType: 'ResortDependents',
            aggregateId: event.aggregateId,
            payload: {
              entityType: 'dynamic',
              resortId: positive(event.payload.resortId),
              afterId: 0,
            },
          });
        },
      );
    if (event.eventType === 'dictionary.changed.v1')
      return this.inbox.executeOnce(
        {
          consumerKey: 'rag-dictionary-dependencies.v1',
          eventId: event.eventId,
          eventType: event.eventType,
        },
        async (tx) => {
          const dictType = event.payload.dictType;
          if (typeof dictType !== 'string' || dictType.length > 100)
            throw new TypeError('Invalid dictionary dependency');
          const definitions = await tx.customFieldDefinition.findMany({
            where: { OptionsDictType: dictType },
            select: { EntityType: true },
            distinct: ['EntityType'],
          });
          const affected = new Set(definitions.map((f) => f.EntityType));
          if (dictType === 'resort.fit_tag') affected.add('ski_resort');
          if (dictType === 'knowledge.article_category')
            affected.add('article');
          for (const entityType of affected)
            if (Object.hasOwn(entities, entityType))
              await appendOutboxEvent(tx, {
                eventType: 'rag.dependencies.changed.v1',
                aggregateType: 'DictionaryDependents',
                aggregateId: dictType,
                payload: { entityType, afterId: 0 },
              });
        },
      );
    if (event.eventType !== 'rag.dependencies.changed.v1') return false;
    const entityType = event.payload.entityType;
    if (typeof entityType !== 'string' || !Object.hasOwn(entities, entityType))
      throw new TypeError('Invalid dependency entity');
    if (
      (event.payload.resortId !== undefined ||
        event.payload.authorId !== undefined) &&
      entityType !== 'dynamic'
    )
      throw new TypeError('Invalid dependency constraint');
    if (
      event.payload.resortId !== undefined &&
      event.payload.authorId !== undefined
    )
      throw new TypeError('Ambiguous dependency constraint');
    const config = entities[entityType as keyof typeof entities];
    const after = integer(event.payload.afterId);
    return this.inbox.executeOnce(
      {
        consumerKey: 'rag-dependency-fanout.v1',
        eventId: event.eventId,
        eventType: event.eventType,
      },
      async (tx) => {
        const table = Prisma.raw('"' + config.table + '"'),
          id = Prisma.raw('"' + config.id + '"');
        const constraint =
          event.payload.resortId !== undefined
            ? Prisma.sql`AND "ResortId"=${positive(event.payload.resortId)}`
            : event.payload.authorId !== undefined
              ? Prisma.sql`AND "AuthorId"=${positive(event.payload.authorId)}`
              : Prisma.empty;
        const maximum =
          event.payload.maxId === undefined
            ? ((
                await tx.$queryRaw<{ max: number | null }[]>(
                  Prisma.sql`SELECT MAX(${id}) AS max FROM ${table} WHERE true ${constraint}`,
                )
              )[0]?.max ?? 0)
            : integer(event.payload.maxId);
        const rows = await tx.$queryRaw<{ id: number }[]>(
          Prisma.sql`SELECT ${id} AS id FROM ${table} WHERE ${id}>${after} AND ${id}<=${maximum} ${constraint} ORDER BY ${id} ASC LIMIT 200`,
        );
        if (rows.length)
          await tx.outboxEvent.createMany({
            data: rows.map((row) => ({
              EventType: config.event,
              AggregateType: config.table,
              AggregateId: String(row.id),
              Payload: { [config.key]: row.id },
            })),
          });
        const cursor = rows.at(-1)?.id;
        if (rows.length === 200 && cursor !== undefined && cursor < maximum)
          await appendOutboxEvent(tx, {
            eventType: event.eventType,
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            payload: { ...event.payload, afterId: cursor, maxId: maximum },
          });
      },
    );
  }
}
function integer(value: unknown) {
  if (
    !Number.isInteger(value) ||
    Number(value) < 0 ||
    Number(value) > 2147483647
  )
    throw new TypeError('Invalid dependency cursor');
  return Number(value);
}
function positive(value: unknown) {
  const id = integer(value);
  if (!id) throw new TypeError('Invalid dependency target');
  return id;
}
