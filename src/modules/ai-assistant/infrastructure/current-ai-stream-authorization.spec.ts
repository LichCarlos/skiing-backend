import { describe, expect, it, vi } from 'vitest';
import type { ResolveAuthorizationPrincipal } from '../../identity-access/application/resolve-authorization-principal.js';
import type { AuthSessionRepository } from '../../identity-access/application/ports/auth-session-repository.js';
import type { AuthorizationPrincipal } from '../../identity-access/domain/authorization.js';
import { AiStreamAccessRejectedError } from '../application/ports/ai-stream-authorization.js';
import { CurrentAiStreamAuthorization } from './current-ai-stream-authorization.js';

const principal: AuthorizationPrincipal = {
  userId: 7,
  active: true,
  merchantId: 3,
  roles: [
    {
      roleKey: 'custom',
      active: true,
      dataScope: 'merchant',
      permissionKeys: ['ai:conversation:use', 'ai:rag:query'],
    },
  ],
};
const input = { userId: 7, sessionId: 'session', principal };
function fixture() {
  const isActive = vi.fn<AuthSessionRepository['isActive']>(async () => true);
  const execute = vi.fn<ResolveAuthorizationPrincipal['execute']>(async () =>
    structuredClone(principal),
  );
  const authorization = new CurrentAiStreamAuthorization(
    { isActive } as unknown as AuthSessionRepository,
    { execute } as unknown as ResolveAuthorizationPrincipal,
  );
  return { isActive, execute, authorization };
}
describe('Current AI stream authorization', () => {
  it('rechecks the original session and effective principal without caching', async () => {
    const { isActive, execute, authorization } = fixture();
    await authorization.assert(input);
    await authorization.assert(input);
    expect(isActive).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(isActive).toHaveBeenCalledWith({
      userId: 7,
      sessionId: 'session',
      now: expect.any(Date),
    });
    isActive.mockResolvedValue(false);
    await expect(authorization.assert(input)).rejects.toMatchObject({
      reason: 'session',
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it.each([
    null,
    { ...principal, active: false },
    { ...principal, userId: 8 },
    { ...principal, roles: [] },
    { ...principal, roles: [{ ...principal.roles[0]!, active: false }] },
    {
      ...principal,
      roles: [{ ...principal.roles[0]!, permissionKeys: ['ai:rag:query'] }],
    },
  ])('rejects a revoked/invalid current principal: %j', async (current) => {
    const { execute, authorization } = fixture();
    execute.mockResolvedValue(current);
    await expect(authorization.assert(input)).rejects.toMatchObject({
      reason: 'permission',
    });
  });
  it.each([
    { ...principal, merchantId: 4 },
    { ...principal, merchantId: null },
    {
      ...principal,
      roles: [{ ...principal.roles[0]!, dataScope: 'self' as const }],
    },
    {
      ...principal,
      roles: [{ ...principal.roles[0]!, dataScope: 'all' as const }],
    },
    {
      ...principal,
      roles: [
        { ...principal.roles[0]!, permissionKeys: ['ai:conversation:use'] },
      ],
    },
    {
      ...principal,
      roles: [
        ...principal.roles,
        { ...principal.roles[0]!, dataScope: 'all' as const },
      ],
    },
  ])('stops when effective RAG scope changes: %j', async (current) => {
    const { execute, authorization } = fixture();
    execute.mockResolvedValue(current);
    await expect(authorization.assert(input)).rejects.toMatchObject({
      reason: 'permission',
    });
  });
  it('allows an unrelated grant or role label change with identical effective access', async () => {
    const { execute, authorization } = fixture();
    execute.mockResolvedValue({
      ...principal,
      roles: [
        {
          ...principal.roles[0]!,
          roleKey: 'renamed',
          permissionKeys: [
            ...principal.roles[0]!.permissionKeys,
            'unrelated:read',
          ],
        },
      ],
    });
    await expect(authorization.assert(input)).resolves.toBeUndefined();
  });
  it.each([
    { ...input, sessionId: '' },
    { ...input, userId: 8 },
    { ...input, userId: NaN },
  ])(
    'rejects an invalid server session binding before reading storage',
    async (value) => {
      const { isActive, authorization } = fixture();
      await expect(authorization.assert(value)).rejects.toBeInstanceOf(
        AiStreamAccessRejectedError,
      );
      expect(isActive).not.toHaveBeenCalled();
    },
  );
  it('fails closed on authorization or session store outages', async () => {
    const { isActive, execute, authorization } = fixture();
    execute.mockRejectedValue(new Error('principal database unavailable'));
    await expect(authorization.assert(input)).rejects.toThrow(
      'principal database unavailable',
    );
    isActive.mockRejectedValue(new Error('session database unavailable'));
    await expect(authorization.assert(input)).rejects.toThrow(
      'session database unavailable',
    );
  });
});
