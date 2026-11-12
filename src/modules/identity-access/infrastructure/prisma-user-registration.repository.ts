import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import {
  AccountAlreadyRegisteredError,
  ActiveUserRoleUnavailableError,
} from '../application/register-user.js';
import type {
  RegisteredUserRecord,
  UserRegistrationRepository,
} from '../application/ports/user-registration-repository.js';
import type { RegisterUserRecord } from '../application/ports/user-registration-repository.js';

function isAccountUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    code?: unknown;
    meta?: { target?: unknown };
  };
  if (candidate.code !== 'P2002') return false;

  const target = candidate.meta?.target;
  return Array.isArray(target)
    ? target.includes('Account')
    : typeof target === 'string' && target.includes('Account');
}

@Injectable()
export class PrismaUserRegistrationRepository implements UserRegistrationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async register(input: RegisterUserRecord): Promise<RegisteredUserRecord> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const role = await transaction.role.findUnique({
          where: { SystemRoleCode: 'registered_user' },
          select: { RoleId: true, Status: true },
        });
        if (!role || role.Status !== 'active') {
          throw new ActiveUserRoleUnavailableError();
        }

        const user = await transaction.user.create({
          data: {
            Account: input.account,
            PasswordHash: input.passwordHash,
            Nickname: input.nickname,
            UserRoles: {
              create: {
                Role: { connect: { RoleId: role.RoleId } },
              },
            },
          },
          select: { UserId: true, Account: true, Nickname: true },
        });

        return {
          userId: user.UserId,
          account: user.Account,
          nickname: user.Nickname,
        };
      });
    } catch (error) {
      if (isAccountUniqueViolation(error)) {
        throw new AccountAlreadyRegisteredError();
      }
      throw error;
    }
  }
}
