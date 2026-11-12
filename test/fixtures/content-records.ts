import type {
  ArticleRecord,
  ProjectKnowledgeRecord,
} from '../../src/modules/knowledge-content/application/content-models.js';
export function articleRecord(
  change: Partial<ArticleRecord> = {},
): ArticleRecord {
  return {
    articleId: 19,
    title: 'Ski basics',
    summary: 'Summary',
    body: 'Body',
    coverAssetId: '91',
    coverStorageKey: 'cover',
    categoryValue: 'basics',
    category: { value: 'basics', label: 'Basics' },
    authorId: 3,
    authorName: 'Editor',
    status: 'published',
    publishTime: new Date('2026-10-01T00:00:00Z'),
    version: 2,
    customFields: {},
    schemaVersion: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...change,
  };
}
export function projectKnowledgeRecord(
  change: Partial<ProjectKnowledgeRecord> = {},
): ProjectKnowledgeRecord {
  return {
    projectKnowledgeId: 7,
    title: 'Platform',
    content: 'Public instructions',
    category: 'platform',
    sourceUrl: null,
    status: 'draft',
    publishTime: null,
    version: 2,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
    ...change,
  };
}
