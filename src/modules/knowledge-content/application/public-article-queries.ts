import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ASSET_STORAGE,
  type AssetStorage,
} from '../../assets/application/ports/asset-storage.js';
import {
  PUBLIC_ARTICLE_READER,
  type PublicArticleReader,
} from './ports/public-article-reader.js';
import { contentPage } from '../domain/content-rules.js';
import type {
  PublicArticleQuery,
  PublicArticleRecord,
} from './content-models.js';
@Injectable()
export class PublicArticleQueries {
  constructor(
    @Inject(PUBLIC_ARTICLE_READER) private readonly reader: PublicArticleReader,
    @Inject(ASSET_STORAGE) private readonly storage: AssetStorage,
  ) {}
  categories() {
    return this.reader.categories();
  }
  async list(query: PublicArticleQuery, userId?: number) {
    let paging: ReturnType<typeof contentPage>;
    try {
      paging = contentPage(query);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid pagination',
      );
    }
    const { items, total } = await this.reader.findPage(
      {
        skip: paging.skip,
        take: paging.pageSize,
        keyword: query.keyword?.trim(),
        categoryValue: query.categoryValue,
      },
      userId,
    );
    return {
      items: await Promise.all(items.map((item) => this.toSummary(item))),
      page: paging.page,
      pageSize: paging.pageSize,
      total,
      hasNext: paging.skip + items.length < total,
    };
  }
  async get(id: number, userId?: number) {
    if (!Number.isSafeInteger(id) || id < 1 || id > 2_147_483_647)
      throw new BadRequestException('Invalid article ID');
    const record = await this.reader.find(id, userId);
    if (!record) throw new NotFoundException('Article not found');
    return { ...(await this.toSummary(record)), body: record.body,
      contentFormat: record.contentFormat ?? 'plain_text',
      bodyAssets: await Promise.all((record.bodyAssets ?? []).map(async (asset) => ({ assetId: asset.assetId, url: await this.storage.createReadUrl(asset.storageKey, 900) }))),
    };
  }
  private async toSummary(record: PublicArticleRecord) {
    return {
      articleId: record.articleId,
      title: record.title,
      summary: record.summary,
      coverUrl: record.coverStorageKey
        ? await this.storage.createReadUrl(record.coverStorageKey, 900)
        : null,
      category: record.category,
      authorName: record.authorName,
      publishTime: record.publishTime.toISOString(),
      favoriteByMe: record.favoriteByMe,
    };
  }
}
