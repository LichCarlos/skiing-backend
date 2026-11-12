import type { RagSourceState } from '../../domain/rag-source-state.js';

export const RAG_SOURCE_READER = Symbol('RAG_SOURCE_READER');

interface SourceRecord {
  id: number;
  status: string;
  deletedAt: Date | null;
  updatedAt: Date;
  sourceState: RagSourceState;
}

export interface ResortRagSource extends SourceRecord {
  publicFields?: { fieldKey: string; label: string; value: unknown }[];
  name: string;
  province: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  price: number;
  openStatus: string;
  snowCondition: string;
  openingHours: string | null;
  trailSummary: string | null;
  facilitySummary: string | null;
  description: string;
  fitTags: string[];
}

export interface ArticleRagSource extends SourceRecord {
  title: string;
  summary: string;
  body: string;
  categoryValue: string;
  authorName: string | null;
  publishedAt: Date | null;
  categoryIsPublic: boolean;
  publicFields: { fieldKey: string; label: string; value: unknown }[];
}

export interface ProjectRagSource extends SourceRecord {
  title: string;
  content: string;
  category: string;
  sourceUrl: string | null;
  publishedAt: Date | null;
}

export interface DynamicRagSource extends SourceRecord {
  publicFields?: { fieldKey: string; label: string; value: unknown }[];
  content: string;
  author: { nickname: string; status: string };
  resort: { name: string; status: string; deletedAt: Date | null } | null;
}

export interface DictionaryRagSource {
  type: { name: string; status: string; publiclyReadable: boolean } | null;
  item: {
    id: number;
    value: string;
    label: string;
    status: string;
    updatedAt: Date;
  } | null;
  breadcrumb: { id: number; parentId: number | null; label: string }[] | null;
  sourceState: RagSourceState | null;
}

export interface RagSourceReader {
  findDictionaryType(itemId: number): Promise<string | null>;
  findResort(id: number): Promise<ResortRagSource | null>;
  findArticle(id: number): Promise<ArticleRagSource | null>;
  findProjectKnowledge(id: number): Promise<ProjectRagSource | null>;
  findDynamic(id: number): Promise<DynamicRagSource | null>;
  findDictionary(
    dictType: string,
    itemId: number,
  ): Promise<DictionaryRagSource>;
}
