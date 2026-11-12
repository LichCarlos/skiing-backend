import { describe, expect, it, vi } from 'vitest';
import { ResetManagedPassword } from './reset-managed-password.js';
import { ManagementWriteAuthorizationError } from '../domain/management-write-authorization.js';
import {
  PasswordResetConflictError,
  PasswordResetTargetMissingError,
} from '../domain/password-reset.js';
const input = {
  userId: 7,
  newPassword: ' unchanged whitespace ',
  reason: '  support request  ',
  audit: {
    actorUserId: 1,
    traceId: 'validation',
    clientIp: null,
    userAgent: null,
  },
};
function setup() {
  const reset = vi.fn().mockResolvedValue(undefined),
    hash = vi.fn().mockResolvedValue('hashed');
  return {
    reset,
    hash,
    usecase: new ResetManagedPassword({ reset }, { hash, verify: vi.fn() }),
  };
}
describe('reset an existing managed password', () => {
  it('preserves password bytes, trims the reason and sends only a hash to persistence', async () => {
    const { reset, hash, usecase } = setup();
    await usecase.execute(input);
    expect(hash).toHaveBeenCalledExactlyOnceWith(input.newPassword);
    expect(reset).toHaveBeenCalledExactlyOnceWith({
      userId: 7,
      passwordHash: 'hashed',
      reason: 'support request',
      audit: input.audit,
      now: expect.any(Date),
    });
    expect(JSON.stringify(reset.mock.calls)).not.toContain(input.newPassword);
  });
  it.each([
    { userId: 0 },
    { userId: 2147483648 },
    { userId: 1.5 },
    { newPassword: 'short' },
    { newPassword: '雪'.repeat(25) },
    { reason: ' ' },
    { reason: 'x'.repeat(501) },
  ])('rejects invalid input %j before hashing', async (patch) => {
    const { hash, reset, usecase } = setup();
    await expect(usecase.execute({ ...input, ...patch })).rejects.toMatchObject(
      { status: 400 },
    );
    expect(hash).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });
  it.each([
    [new ManagementWriteAuthorizationError('revoked'), 403],
    [new PasswordResetTargetMissingError(), 404],
    [new PasswordResetConflictError(), 409],
  ] as const)('maps authoritative failure to %s/%s', async (error, status) => {
    const { reset, usecase } = setup();
    reset.mockRejectedValueOnce(error);
    await expect(usecase.execute(input)).rejects.toMatchObject({ status });
  });
  it('does not persist a password when hashing fails', async () => {
    const { reset, hash, usecase } = setup();
    hash.mockRejectedValueOnce(new Error('hasher unavailable'));
    await expect(usecase.execute(input)).rejects.toThrow('hasher unavailable');
    expect(reset).not.toHaveBeenCalled();
  });
});
