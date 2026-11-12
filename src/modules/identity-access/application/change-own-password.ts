import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { isValidPasswordLength } from '../domain/registration-rules.js';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from './ports/password-hasher.js';
import {
  SELF_PASSWORD_CHANGE_REPOSITORY,
  type SelfPasswordChangeRepository,
} from './ports/self-password-change-repository.js';

@Injectable()
export class ChangeOwnPassword {
  constructor(
    @Inject(SELF_PASSWORD_CHANGE_REPOSITORY)
    private readonly repository: SelfPasswordChangeRepository,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
  ) {}

  async execute(input: {
    userId: number;
    currentPassword: string;
    newPassword: string;
    traceId: string;
    clientIp: string | null;
    userAgent: string | null;
  }): Promise<void> {
    if (!Number.isSafeInteger(input.userId) || input.userId < 1) {
      throw new UnauthorizedException();
    }
    if (!isValidPasswordLength(input.newPassword)) {
      throw new BadRequestException('Password must be 8 to 72 UTF-8 bytes');
    }
    const currentHash = await this.repository.findPasswordHash(input.userId);
    if (
      !currentHash ||
      !(await this.passwords.verify(input.currentPassword, currentHash))
    ) {
      throw new UnauthorizedException('Current password is invalid');
    }
    if (await this.passwords.verify(input.newPassword, currentHash)) {
      throw new BadRequestException(
        'New password must differ from current password',
      );
    }
    const passwordHash = await this.passwords.hash(input.newPassword);
    const updated = await this.repository.updatePassword({
      userId: input.userId,
      expectedPasswordHash: currentHash,
      passwordHash,
      traceId: input.traceId,
      clientIp: input.clientIp,
      userAgent: input.userAgent,
      now: new Date(),
    });
    if (!updated) throw new UnauthorizedException();
  }
}
