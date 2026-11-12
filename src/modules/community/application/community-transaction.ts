import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CommunityRuleError } from '../domain/community-rules.js';
import type {
  CommunityTransaction,
  CommunityUnitOfWork,
} from './ports/community-unit-of-work.js';
export function communityInput<T>(validate: () => T): T {
  try {
    return validate();
  } catch (error) {
    return throwCommunityError(error);
  }
}
function throwCommunityError(error: unknown): never {
  if (!(error instanceof CommunityRuleError)) throw error;
  if (error.kind === 'invalid') throw new BadRequestException(error.message);
  if (error.kind === 'reference') throw new NotFoundException(error.message);
  throw new ConflictException(error.message);
}
export async function runCommunityTransaction<T>(
  uow: CommunityUnitOfWork,
  work: (tx: CommunityTransaction) => Promise<T>,
): Promise<T> {
  try {
    return await uow.run(work);
  } catch (error) {
    return throwCommunityError(error);
  }
}
