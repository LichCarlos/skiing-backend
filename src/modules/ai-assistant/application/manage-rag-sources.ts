import { Inject, Injectable } from '@nestjs/common';
import {
  RAG_SOURCE_MANAGEMENT_REPOSITORY,
  type RagSourceListInput,
  type RagSourceManagementRepository,
} from './ports/rag-source-management.repository.js';

export class RagSourceNotFoundError extends Error {
  constructor() {
    super('RAG source not found');
    this.name = 'RagSourceNotFoundError';
  }
}

export class RagSourceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RagSourceConflictError';
  }
}

export class RagSourcePageInvalidError extends Error {
  constructor() {
    super('RAG source page is invalid');
    this.name = 'RagSourcePageInvalidError';
  }
}

@Injectable()
export class ManageRagSources {
  constructor(
    @Inject(RAG_SOURCE_MANAGEMENT_REPOSITORY)
    private readonly sources: RagSourceManagementRepository,
  ) {}

  async list(userId: number, input: RagSourceListInput) {
    if (
      !Number.isSafeInteger(input.page) ||
      input.page < 1 ||
      !Number.isSafeInteger(input.pageSize) ||
      input.pageSize < 1 ||
      input.pageSize > 100 ||
      (input.page - 1) * input.pageSize > 2_147_483_647
    ) {
      throw new RagSourcePageInvalidError();
    }
    const keyword = input.keyword?.trim();
    return {
      ...(await this.sources.list(userId, {
        ...input,
        ...(keyword ? { keyword } : { keyword: undefined }),
      })),
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  async find(userId: number, ragDocumentId: number) {
    const source = await this.sources.find(userId, ragDocumentId);
    if (!source) throw new RagSourceNotFoundError();
    return source;
  }

  reindex(
    userId: number,
    ragDocumentId: number,
    input: { expectedVersion: number; reason: string; traceId: string },
  ) {
    return this.sources.reindex(userId, ragDocumentId, input);
  }

  setEnabled(
    userId: number,
    ragDocumentId: number,
    input: {
      enabled: boolean;
      expectedVersion: number;
      reason: string;
      traceId: string;
    },
  ) {
    return this.sources.setEnabled(userId, ragDocumentId, input);
  }
}
