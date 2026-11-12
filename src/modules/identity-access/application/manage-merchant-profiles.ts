import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  merchantTarget,
  merchantText,
  merchantVersion,
} from '../domain/merchant-profile.js';
import {
  MERCHANT_PROFILE_REPOSITORY,
  type MerchantProfileRepository,
  type MerchantProfileCommand,
} from './ports/merchant-profile-repository.js';

@Injectable()
export class ManageMerchantProfiles {
  constructor(
    @Inject(MERCHANT_PROFILE_REPOSITORY)
    private readonly repository: MerchantProfileRepository,
  ) {}
  read(userId: number, actor: number) {
    this.validate(() => merchantTarget(userId));
    return this.repository.read(userId, actor);
  }
  schema(actor: number) {
    return this.repository.schema(actor);
  }
  write(input: MerchantProfileCommand) {
    const command = this.validate(() => {
      merchantTarget(input.userId);
      const reason = merchantText(input.reason, 500);
      if (input.kind !== 'create') merchantVersion(input.expectedVersion);
      const patch = { ...input.patch };
      if (patch.businessName !== undefined)
        patch.businessName = merchantText(patch.businessName, 100);
      if (patch.contact !== undefined && patch.contact !== null)
        patch.contact = merchantText(patch.contact, 100);
      if (input.kind === 'create' && !patch.businessName)
        throw new RangeError();
      if (
        input.kind === 'update' &&
        patch.businessName === undefined &&
        patch.contact === undefined &&
        !Object.keys(patch.customFields ?? {}).length
      )
        throw new RangeError();
      if (
        input.kind === 'status' &&
        !['active', 'disabled'].includes(input.status ?? '')
      )
        throw new RangeError();
      return { ...input, reason, patch };
    });
    return this.repository.write(command);
  }
  private validate<T>(work: () => T): T {
    try {
      return work();
    } catch {
      throw new BadRequestException('Invalid merchant profile input');
    }
  }
}
