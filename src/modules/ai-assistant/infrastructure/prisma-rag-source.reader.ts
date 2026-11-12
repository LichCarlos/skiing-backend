import { articleReadableText } from '../../../shared/content/markdown.js';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { isPublishableProjectKnowledge } from '../../knowledge-content/application/ports/public-project-knowledge-policy.js';
import type { RagSourceReader } from '../application/ports/rag-source-reader.js';
import {
  publicFieldState,
  articleSourceState,
  dictionarySourceState,
  dynamicSourceState,
  projectSourceState,
  resortSourceState,
} from '../domain/rag-source-state.js';

@Injectable()
export class PrismaRagSourceReader implements RagSourceReader {
  constructor(private readonly prisma: PrismaService) {}

  async findDictionaryType(itemId: number): Promise<string | null> {
    const row = await this.prisma.dictionaryItem.findUnique({
      where: { ItemId: itemId },
      select: { DictType: true },
    });
    return row?.DictType ?? null;
  }

  async findResort(id: number) {
    return this.prisma.$transaction(
      async (tx) => {
        const row = await tx.skiResort.findUnique({
          where: { ResortId: id },
          select: {
            ResortId: true,
            Name: true,
            CustomFields: true,
            Province: true,
            City: true,
            District: true,
            Address: true,
            Price: true,
            OpenStatus: true,
            SnowCondition: true,
            OpeningHours: true,
            TrailSummary: true,
            FacilitySummary: true,
            Description: true,
            Status: true,
            UpdateTime: true,
            DeletedAt: true,
            FitTags: { select: { Item: { select: { Value: true } } } },
          },
        });
        if (!row) return null;
        const definitions = await publicDefinitions(tx, 'ski_resort');
        return {
          id: row.ResortId,
          name: row.Name,
          province: row.Province,
          city: row.City,
          district: row.District,
          address: row.Address,
          price: row.Price,
          openStatus: row.OpenStatus,
          snowCondition: row.SnowCondition,
          openingHours: row.OpeningHours,
          trailSummary: row.TrailSummary,
          facilitySummary: row.FacilitySummary,
          description: row.Description,
          status: row.Status,
          updatedAt: row.UpdateTime,
          deletedAt: row.DeletedAt,
          fitTags: row.FitTags.map(({ Item }) => Item.Value),
          publicFields: publicFields(row.CustomFields, definitions),
          sourceState: resortSourceState(row, definitions),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  findArticle(id: number) {
    return this.prisma.$transaction(
      async (tx) => {
        const row = await tx.article.findUnique({
          where: { ArticleId: id },
          select: {
            ArticleId: true,
            Title: true,
            Summary: true,
            Body: true,
            ContentFormat: true,
            CategoryValue: true,
            AuthorName: true,
            CustomFields: true,
            Status: true,
            UpdateTime: true,
            DeletedAt: true,
            PublishTime: true,
            Category: {
              select: {
                DictType: true,
                Status: true,
                Type: { select: { Status: true, PubliclyReadable: true } },
              },
            },
          },
        });
        if (!row) return null;
        const definitions = await publicDefinitions(tx, 'article');
        const values = isRecord(row.CustomFields) ? row.CustomFields : {};
        return {
          id: row.ArticleId,
          title: row.Title,
          summary: row.Summary,
          body: articleReadableText(row.Body, row.ContentFormat),
          categoryValue: row.CategoryValue,
          authorName: row.AuthorName,
          publishedAt: row.PublishTime,
          categoryIsPublic:
            row.Category.DictType === 'knowledge.article_category' &&
            row.Category.Status === 'active' &&
            row.Category.Type.Status === 'active' &&
            row.Category.Type.PubliclyReadable,
          status: row.Status,
          updatedAt: row.UpdateTime,
          deletedAt: row.DeletedAt,
          publicFields: publicFields(values, definitions),
          sourceState: articleSourceState(row, definitions),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async findProjectKnowledge(id: number) {
    const row = await this.prisma.projectKnowledge.findUnique({
      where: { ProjectKnowledgeId: id },
      select: {
        ProjectKnowledgeId: true,
        Title: true,
        Content: true,
        Category: true,
        SourceUrl: true,
        Status: true,
        PublishTime: true,
        UpdateTime: true,
        DeletedAt: true,
      },
    });
    if (
      !row ||
      !isPublishableProjectKnowledge({
        title: row.Title,
        content: row.Content,
        category: row.Category,
        sourceUrl: row.SourceUrl,
      })
    )
      return null;
    return {
      id: row.ProjectKnowledgeId,
      title: row.Title,
      content: row.Content,
      category: row.Category,
      sourceUrl: row.SourceUrl,
      status: row.Status,
      publishedAt: row.PublishTime,
      updatedAt: row.UpdateTime,
      deletedAt: row.DeletedAt,
      sourceState: projectSourceState(row),
    };
  }

  async findDynamic(id: number) {
    return this.prisma.$transaction(
      async (tx) => {
        const row = await tx.dynamic.findUnique({
          where: { DynamicId: id },
          select: {
            DynamicId: true,
            Content: true,
            ContentFormat: true,
            CustomFields: true,
            Status: true,
            DeletedAt: true,
            UpdateTime: true,
            Author: { select: { Nickname: true, Status: true } },
            Resort: { select: { Name: true, Status: true, DeletedAt: true } },
          },
        });
        if (!row) return null;
        const definitions = await publicDefinitions(tx, 'dynamic');
        return {
          id: row.DynamicId,
          content: articleReadableText(row.Content, row.ContentFormat),
          status: row.Status,
          deletedAt: row.DeletedAt,
          updatedAt: row.UpdateTime,
          author: { nickname: row.Author.Nickname, status: row.Author.Status },
          resort: row.Resort
            ? {
                name: row.Resort.Name,
                status: row.Resort.Status,
                deletedAt: row.Resort.DeletedAt,
              }
            : null,
          publicFields: publicFields(row.CustomFields, definitions),
          sourceState: dynamicSourceState(row, definitions),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  findDictionary(dictType: string, itemId: number) {
    return this.prisma.$transaction(
      async (tx) => {
        const type = await tx.dictionaryType.findUnique({
          where: { DictType: dictType },
          select: { DictName: true, Status: true, PubliclyReadable: true },
        });
        const item = await tx.dictionaryItem.findFirst({
          where: { DictType: dictType, ItemId: itemId },
          select: {
            ItemId: true,
            Value: true,
            Label: true,
            Status: true,
            ParentId: true,
            UpdateTime: true,
          },
        });
        const path: {
          ItemId: number;
          ParentId: number | null;
          Label: string;
        }[] = [];
        if (
          type?.Status === 'active' &&
          type.PubliclyReadable &&
          item?.Status === 'active'
        ) {
          path.push(item);
          const visited = new Set([item.ItemId]);
          let parentId = item.ParentId;
          while (parentId !== null) {
            if (path.length >= 64 || visited.has(parentId)) {
              path.length = 0;
              break;
            }
            const parent = await tx.dictionaryItem.findFirst({
              where: { DictType: dictType, ItemId: parentId, Status: 'active' },
              select: { ItemId: true, ParentId: true, Label: true },
            });
            if (!parent) {
              path.length = 0;
              break;
            }
            path.push(parent);
            visited.add(parent.ItemId);
            parentId = parent.ParentId;
          }
          path.reverse();
        }
        return {
          type: type
            ? {
                name: type.DictName,
                status: type.Status,
                publiclyReadable: type.PubliclyReadable,
              }
            : null,
          item: item
            ? {
                id: item.ItemId,
                value: item.Value,
                label: item.Label,
                status: item.Status,
                updatedAt: item.UpdateTime,
              }
            : null,
          breadcrumb: path.length
            ? path.map((node) => ({
                id: node.ItemId,
                parentId: node.ParentId,
                label: node.Label,
              }))
            : null,
          sourceState:
            type && item && path.length
              ? dictionarySourceState(dictType, type.DictName, item.Value, path)
              : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function publicDefinitions(tx: Prisma.TransactionClient, entity: string) {
  return tx.customFieldDefinition.findMany({
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
    select: {
      FieldKey: true,
      Label: true,
      OptionsType: {
        select: {
          Items: {
            where: { Status: 'active' },
            select: { Value: true, Label: true },
          },
        },
      },
    },
  });
}
function publicFields(
  value: unknown,
  definitions: Parameters<typeof publicFieldState>[1],
) {
  return publicFieldState(value, definitions).map((f) => {
    const field = f as {
      key: string;
      label: string;
      value: unknown;
      options: unknown;
    };
    return {
      fieldKey: field.key,
      label: field.label,
      value: { value: field.value, options: field.options },
    };
  });
}
