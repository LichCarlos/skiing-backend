import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MANAGED_DICTIONARY_REPOSITORY,
  type ManagedDictionaryRepository,
} from './ports/managed-dictionary-repository.js';
import {
  DictionaryActorUnavailableError,
  DictionaryParentInvalidError,
  DictionaryValueInUseError,
  ManagedDictionaryNotFoundError,
} from './dictionary-management-errors.js';
import { ManagementWriteAuthorizationError } from '../../identity-access/domain/management-write-authorization.js';
import {
  validateDictionaryItem,
  validateDictionaryType,
  validateDictionaryTypePatch,
  type DictionaryAuditContext,
  type DictionaryStatus,
} from '../domain/managed-dictionary.js';

@Injectable()
export class ManageDictionaries {
  constructor(
    @Inject(MANAGED_DICTIONARY_REPOSITORY)
    private readonly dictionaries: ManagedDictionaryRepository,
  ) {}

  async listTypes(input: {
    page: number;
    pageSize: number;
    groupKey?: string;
    status?: DictionaryStatus;
  }) {
    const skip = (input.page - 1) * input.pageSize;
    if (
      !Number.isSafeInteger(input.page) ||
      input.page < 1 ||
      !Number.isSafeInteger(input.pageSize) ||
      input.pageSize < 1 ||
      input.pageSize > 100 ||
      !Number.isSafeInteger(skip)
    ) {
      throw new BadRequestException('Dictionary pagination is invalid');
    }
    const result = await this.dictionaries.listTypes({
      skip,
      take: input.pageSize,
      ...(input.groupKey?.trim() ? { groupKey: input.groupKey.trim() } : {}),
      ...(input.status ? { status: input.status } : {}),
    });
    return {
      ...result,
      page: input.page,
      pageSize: input.pageSize,
      hasNext: input.page < Math.ceil(result.total / input.pageSize),
    };
  }

  async getType(dictType: string) {
    const dictionary = await this.dictionaries.findType(dictType);
    if (!dictionary) throw new NotFoundException('Dictionary type not found');
    return dictionary;
  }

  async getItem(dictType: string, itemId: number) {
    this.assertItemId(itemId);
    const dictionary = await this.getType(dictType);
    const pending = [...dictionary.items];
    while (pending.length) {
      const item = pending.pop()!;
      if (item.itemId === itemId) return item;
      pending.push(...item.children);
    }
    throw new NotFoundException('Dictionary item not found');
  }

  async createType(input: {
    dictType: string;
    dictName: string;
    groupKey: string;
    publiclyReadable?: boolean;
    audit: DictionaryAuditContext;
  }) {
    const issues = validateDictionaryType(input);
    if (issues.length) this.invalid('Dictionary type is invalid', issues);
    try {
      return await this.dictionaries.createType({
        dictType: input.dictType,
        dictName: input.dictName.trim(),
        groupKey: input.groupKey,
        publiclyReadable: input.publiclyReadable ?? false,
        audit: input.audit,
      });
    } catch (error) {
      this.mapRepositoryError(error);
    }
  }

  async updateType(input: {
    dictType: string;
    patch: {
      dictName?: string;
      groupKey?: string;
      status?: DictionaryStatus;
      publiclyReadable?: boolean;
    };
    audit: DictionaryAuditContext;
  }) {
    const issues = validateDictionaryTypePatch(input.patch);
    if (issues.length)
      this.invalid('Dictionary type update is invalid', issues);
    try {
      const result = await this.dictionaries.updateType({
        dictType: input.dictType,
        patch: {
          ...input.patch,
          ...(input.patch.dictName !== undefined
            ? { dictName: input.patch.dictName.trim() }
            : {}),
        },
        audit: input.audit,
      });
      if (!result) throw new NotFoundException('Dictionary type not found');
      return result;
    } catch (error) {
      this.mapRepositoryError(error);
    }
  }

  async disableType(input: {
    dictType: string;
    audit: DictionaryAuditContext;
  }): Promise<void> {
    try {
      if (!(await this.dictionaries.disableType(input)))
        throw new NotFoundException('Dictionary type not found');
    } catch (error) {
      this.mapRepositoryError(error);
    }
  }

  async createItem(input: {
    dictType: string;
    item: {
      label: string;
      value: string;
      parentId: number | null;
      color: string | null;
      sortOrder: number;
      isDefault: boolean;
    };
    audit: DictionaryAuditContext;
  }) {
    const issues = validateDictionaryItem(input.item);
    if (issues.length) this.invalid('Dictionary item is invalid', issues);
    try {
      const item = await this.dictionaries.createItem({
        ...input,
        item: {
          ...input.item,
          label: input.item.label.trim(),
          value: input.item.value.trim(),
        },
      });
      if (!item) throw new NotFoundException('Dictionary type not found');
      return item;
    } catch (error) {
      this.mapRepositoryError(error);
    }
  }

  async updateItem(input: {
    dictType: string;
    itemId: number;
    patch: {
      label?: string;
      value?: string;
      parentId?: number | null;
      color?: string | null;
      sortOrder?: number;
      isDefault?: boolean;
      status?: DictionaryStatus;
    };
    audit: DictionaryAuditContext;
  }) {
    this.assertItemId(input.itemId);
    const issues = validateDictionaryItem(input.patch);
    if (issues.length)
      this.invalid('Dictionary item update is invalid', issues);
    try {
      const item = await this.dictionaries.updateItem({
        ...input,
        patch: {
          ...input.patch,
          ...(input.patch.label !== undefined
            ? { label: input.patch.label.trim() }
            : {}),
          ...(input.patch.value !== undefined
            ? { value: input.patch.value.trim() }
            : {}),
        },
      });
      if (!item) throw new NotFoundException('Dictionary item not found');
      return item;
    } catch (error) {
      this.mapRepositoryError(error);
    }
  }

  async disableItem(input: {
    dictType: string;
    itemId: number;
    audit: DictionaryAuditContext;
  }): Promise<void> {
    this.assertItemId(input.itemId);
    try {
      if (!(await this.dictionaries.disableItem(input)))
        throw new NotFoundException('Dictionary item not found');
    } catch (error) {
      this.mapRepositoryError(error);
    }
  }

  private assertItemId(itemId: number): void {
    if (!Number.isSafeInteger(itemId) || itemId < 1 || itemId > 2147483647)
      throw new BadRequestException('Dictionary item ID is invalid');
  }

  private invalid(message: string, codes: string[]): never {
    throw new BadRequestException({
      message,
      details: codes.map((code) => ({ code, message: code })),
    });
  }

  private mapRepositoryError(error: unknown): never {
    if (error instanceof ManagementWriteAuthorizationError)
      throw new ForbiddenException(error.message);
    if (error instanceof ManagedDictionaryNotFoundError)
      throw new NotFoundException(error.message);
    if (error instanceof DictionaryParentInvalidError)
      throw new BadRequestException(error.message);
    if (error instanceof DictionaryValueInUseError)
      throw new ConflictException(error.message);
    if (error instanceof DictionaryActorUnavailableError)
      throw new ConflictException(error.message);
    const code = getPrismaErrorCode(error);
    if (code === 'P2002')
      throw new ConflictException('Dictionary type or value already exists');
    if (code === 'P2003' || code === 'P2014')
      throw new ConflictException('Dictionary value is referenced');
    if (code === 'P2034')
      throw new ConflictException(
        'Dictionary changed concurrently; reload and retry',
      );
    throw error;
  }
}

function getPrismaErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { code?: unknown };
  return typeof candidate.code === 'string' ? candidate.code : null;
}
