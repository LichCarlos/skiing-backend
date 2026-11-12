import { publicFieldStateSql } from './public-field-state.sql.js';
import { Prisma } from '@prisma/client';
import { PROJECT_RAG_POLICY_VERSION } from '../domain/rag-source-state.js';

/** Correlated to the retriever's `document` alias; runs before rank/limit.
 * Unknown/private source kinds and legacy snapshots are deliberately rejected.
 * New private kinds need their own authoritative business-source validator.
 */
export function currentPublicRagSource(): Prisma.Sql {
  return Prisma.sql`
    document."AccessScope" = 'public' AND document."MerchantId" IS NULL
    AND (
      (document."SourceType" = 'resort' AND EXISTS (
        SELECT 1 FROM "SkiResort" r
        WHERE r."ResortId" = document."SourceId"
          AND document."SourceKey" = 'resort:' || r."ResortId"::text
          AND r."Status" = 'published' AND r."DeletedAt" IS NULL
          AND document."Metadata"->'sourceState' = jsonb_build_object(
            'v', 2, 'kind', 'resort', 'fields', ${publicFieldStateSql('ski_resort', 'r')}, 'Name', r."Name",
            'Province', r."Province", 'City', r."City", 'District', r."District",
            'Address', r."Address", 'Price', r."Price", 'OpenStatus', r."OpenStatus",
            'SnowCondition', r."SnowCondition", 'OpeningHours', r."OpeningHours",
            'TrailSummary', r."TrailSummary", 'FacilitySummary', r."FacilitySummary",
            'Description', r."Description", 'tags', COALESCE((
              SELECT jsonb_agg(i."Value" ORDER BY i."Value" COLLATE "C")
              FROM "ResortFitTag" tag JOIN "DictionaryItem" i
                ON i."ItemId" = tag."ItemId" AND i."DictType" = tag."DictType"
              WHERE tag."ResortId" = r."ResortId"
            ), '[]'::jsonb)
          )
      ))
      OR (document."SourceType" = 'article' AND EXISTS (
        SELECT 1 FROM "Article" a
        JOIN "DictionaryItem" category ON category."DictType" = a."CategoryDictType"
          AND category."Value" = a."CategoryValue"
        JOIN "DictionaryType" category_type ON category_type."DictType" = category."DictType"
        WHERE a."ArticleId" = document."SourceId"
          AND document."SourceKey" = 'article:' || a."ArticleId"::text
          AND a."Status" = 'published' AND a."DeletedAt" IS NULL
          AND a."PublishTime" IS NOT NULL
          AND category."DictType" = 'knowledge.article_category'
          AND category."Status" = 'active'
          AND category_type."Status" = 'active' AND category_type."PubliclyReadable" = true
          AND document."Metadata"->'sourceState' = jsonb_build_object(
            'v', 2, 'kind', 'article', 'Title', a."Title", 'Summary', a."Summary",
            'Body', a."Body", 'CategoryValue', a."CategoryValue",
            'AuthorName', a."AuthorName", 'fields', ${publicFieldStateSql('article', 'a')}
          )
      ))
      OR (document."SourceType" = 'project_doc' AND EXISTS (
        SELECT 1 FROM "ProjectKnowledge" p
        WHERE p."ProjectKnowledgeId" = document."SourceId"
          AND document."SourceKey" = 'project:' || p."ProjectKnowledgeId"::text
          AND p."Status" = 'published' AND p."DeletedAt" IS NULL
          AND p."PublishTime" IS NOT NULL
          AND document."Metadata"->'sourceState' = jsonb_build_object(
            'v', ${PROJECT_RAG_POLICY_VERSION}::integer, 'kind', 'project_doc', 'Title', p."Title", 'Content', p."Content",
            'Category', p."Category", 'SourceUrl', p."SourceUrl"
          )
      ))
      OR (document."SourceType" = 'dynamic' AND EXISTS (
        SELECT 1 FROM "Dynamic" d
        JOIN "User" author ON author."UserId" = d."AuthorId"
        LEFT JOIN "SkiResort" resort ON resort."ResortId" = d."ResortId"
        WHERE d."DynamicId" = document."SourceId"
          AND document."SourceKey" = 'dynamic:' || d."DynamicId"::text
          AND d."Status" = 'published' AND d."DeletedAt" IS NULL
          AND author."Status" = 'active'
          AND (d."ResortId" IS NULL OR (
            resort."Status" = 'published' AND resort."DeletedAt" IS NULL
          ))
          AND document."Metadata"->'sourceState' = jsonb_build_object(
            'v', 2, 'kind', 'dynamic', 'fields', ${publicFieldStateSql('dynamic', 'd')}, 'Content', d."Content",
            'Nickname', author."Nickname", 'ResortName', resort."Name"
          )
      ))
      OR (document."SourceType" = 'dictionary' AND EXISTS (
        WITH RECURSIVE ancestry AS (
          SELECT i."ItemId", i."ParentId", i."Label", i."Value", i."DictType",
                 ARRAY[i."ItemId"] AS path, 1 AS depth
          FROM "DictionaryItem" i
          JOIN "DictionaryType" t ON t."DictType" = i."DictType"
          WHERE i."ItemId" = document."SourceId" AND i."Status" = 'active'
            AND t."Status" = 'active' AND t."PubliclyReadable" = true
            AND document."SourceKey" = 'dictionary:' || i."DictType" || ':' || i."Value"
          UNION ALL
          SELECT parent."ItemId", parent."ParentId", parent."Label",
                 parent."Value", parent."DictType", child.path || parent."ItemId",
                 child.depth + 1
          FROM ancestry child JOIN "DictionaryItem" parent
            ON parent."ItemId" = child."ParentId" AND parent."DictType" = child."DictType"
          WHERE parent."Status" = 'active' AND child.depth < 64
            AND NOT parent."ItemId" = ANY(child.path)
        )
        SELECT 1 FROM "DictionaryItem" leaf
        JOIN "DictionaryType" type ON type."DictType" = leaf."DictType"
        WHERE leaf."ItemId" = document."SourceId"
          AND EXISTS (SELECT 1 FROM ancestry WHERE "ParentId" IS NULL)
          AND document."Metadata"->'sourceState' = jsonb_build_object(
            'v', 1, 'kind', 'dictionary', 'DictType', leaf."DictType",
            'DictName', type."DictName", 'Value', leaf."Value", 'breadcrumb', (
              SELECT jsonb_agg(jsonb_build_object(
                'ItemId', "ItemId", 'ParentId', "ParentId", 'Label', "Label"
              ) ORDER BY depth DESC) FROM ancestry
            )
          )
      ))
    )
  `;
}
