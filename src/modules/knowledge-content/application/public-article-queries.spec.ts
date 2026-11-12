import { describe, expect, it, vi } from 'vitest';
import { PublicArticleQueries } from './public-article-queries.js';
import type { PublicArticleReader } from './ports/public-article-reader.js';
import type { AssetStorage } from '../../assets/application/ports/asset-storage.js';
import { articleRecord } from '../../../../test/fixtures/content-records.js';

function setup() {
  const record = {
    ...articleRecord(),
    publishTime: new Date('2026-10-01T00:00:00Z'),
    favoriteByMe: false,
  };
  const reader = {
    categories: vi.fn(async () => [{ value: 'basics', label: 'Basics' }]),
    findPage: vi.fn(async () => ({ items: [record], total: 25 })),
    find: vi.fn(async () => record),
  } satisfies PublicArticleReader;
  const storage = { createReadUrl: vi.fn(async () => 'signed') };
  return {
    queries: new PublicArticleQueries(
      reader,
      storage as unknown as AssetStorage,
    ),
    reader,
    storage,
  };
}
describe('PublicArticleQueries application ports', () => {
  it('passes only the authenticated user ID through the read ports', async () => {
    const { queries, reader } = setup();
    reader.find.mockResolvedValueOnce({
      ...articleRecord(),
      publishTime: new Date(),
      favoriteByMe: true,
    });
    await expect(queries.get(19, 42)).resolves.toMatchObject({
      favoriteByMe: true,
    });
    expect(reader.find).toHaveBeenCalledWith(19, 42);
    await queries.list({}, 42);
    expect(reader.findPage).toHaveBeenCalledWith(expect.any(Object), 42);
  });
  it('normalizes paging and keywords and projects only public summary fields', async () => {
    const { queries, reader } = setup();
    const result = await queries.list({
      page: 2,
      pageSize: 10,
      keyword: ' snow ',
      categoryValue: 'basics',
    });
    expect(reader.findPage).toHaveBeenCalledWith(
      {
        skip: 10,
        take: 10,
        keyword: 'snow',
        categoryValue: 'basics',
      },
      undefined,
    );
    expect(result).toMatchObject({
      page: 2,
      pageSize: 10,
      total: 25,
      hasNext: true,
    });
    expect(result.items[0]).not.toHaveProperty('body');
    expect(result.items[0]).not.toHaveProperty('customFields');
    expect(result.items[0]).not.toHaveProperty('authorId');
  });
  it('returns the detail body without exposing internal values', async () => {
    const { queries } = setup();
    const result = await queries.get(19);
    expect(result).toMatchObject({ body: 'Body', coverUrl: 'signed' });
    expect(result).not.toHaveProperty('version');
    expect(result).not.toHaveProperty('customFields');
  });
  it('rejects invalid pagination before invoking the reader', async () => {
    const { queries, reader } = setup();
    await expect(queries.list({ pageSize: 101 })).rejects.toMatchObject({
      status: 400,
    });
    expect(reader.findPage).not.toHaveBeenCalled();
  });
  it('maps missing/unreadable records to 404 without signing assets', async () => {
    const { queries, reader, storage } = setup();
    reader.find.mockResolvedValueOnce(null as never);
    await expect(queries.get(19)).rejects.toMatchObject({ status: 404 });
    expect(storage.createReadUrl).not.toHaveBeenCalled();
  });
});
