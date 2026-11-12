import { ForbiddenException } from '@nestjs/common';
import { AdminAssetsController } from './admin-assets.controller.js';
import { ManageAdminAssets } from '../../application/manage-admin-assets.js';
import type { ResolvedDataScope } from '../../../identity-access/domain/authorization.js';

describe('Asset inventory propagates supported data scopes', () => {
  function setup(scope?: ResolvedDataScope) {
    const list = vi.fn().mockResolvedValue({ items: [], total: 0 });
    const get = vi.fn().mockResolvedValue({ assetId: '42' });
    const remove = vi.fn().mockResolvedValue(undefined);
    const controller = new AdminAssetsController({
      list,
      get,
      remove,
    } as unknown as ManageAdminAssets);
    const request = {
      authenticatedUserId: 8,
      traceId: 'asset-scope-validation',
      ip: '127.0.0.1',
      authorizationDataScopes: scope ? { asset: scope } : {},
      get: () => undefined,
    } as unknown as Parameters<AdminAssetsController['list']>[1];
    return { controller, request, list, get, remove };
  }

  it.each([
    undefined,
    { kind: 'self', userId: 9 },
    { kind: 'selected', ids: [] },
    { kind: 'selected', ids: [Number.MAX_SAFE_INTEGER + 1] },
    { kind: 'merchant', merchantId: 12 },
  ] satisfies Array<ResolvedDataScope | undefined>)(
    'rejects unsupported scope %j before reading or deleting any asset',
    async (scope) => {
      const { controller, request, list, get, remove } = setup(scope);
      expect(() => controller.list({}, request)).toThrow(ForbiddenException);
      expect(() => controller.get('42', request)).toThrow(ForbiddenException);
      await expect(controller.remove('42', request)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(list).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    },
  );

  it.each([
    { kind: 'all' },
    { kind: 'self', userId: 8 },
    { kind: 'selected', ids: [42] },
  ] satisfies ResolvedDataScope[])(
    'propagates scope %j and server-side audit actor',
    async (scope) => {
      const { controller, request, list, get, remove } = setup(scope);
      await controller.list({ status: 'ready' }, request);
      await controller.get('42', request);
      await controller.remove('42', request);
      expect(list).toHaveBeenCalledWith({ status: 'ready' }, scope, 8);
      expect(get).toHaveBeenCalledWith('42', scope, 8);
      expect(remove).toHaveBeenCalledWith(
        '42',
        expect.objectContaining({ actorUserId: 8 }),
        scope,
      );
    },
  );
});
