import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { CreateCustomFieldDto } from './custom-field.dto.js';
import { CustomFieldsController } from './custom-fields.controller.js';

function requestWithRoles(
  roles: { roleKey: string; active: boolean }[],
): Parameters<CustomFieldsController['create']>[1] {
  return {
    traceId: 'server-field-trace',
    ip: '192.0.2.1',
    get: (name: string) =>
      name === 'user-agent' ? 'field-test-agent' : undefined,
    user: {
      userId: 1,
      active: true,
      merchantId: null,
      roles: roles.map(({ roleKey, active }) => ({
        roleKey,
        active,
        dataScope: 'all',
        permissionKeys: ['system:field:create'],
      })),
    },
  } as unknown as Parameters<CustomFieldsController['create']>[1];
}

describe('CustomFieldsController public-field authorization', () => {
  it('rejects public field creation for non-admin and inactive admin roles', () => {
    const customFields = { create: vi.fn() };
    const controller = new CustomFieldsController(customFields as never);
    const input = { isPublic: true } as CreateCustomFieldDto;

    expect(() =>
      controller.create(
        input,
        requestWithRoles([{ roleKey: 'field_manager', active: true }]),
      ),
    ).toThrow(ForbiddenException);

    expect(() =>
      controller.create(
        input,
        requestWithRoles([{ roleKey: 'system_admin', active: false }]),
      ),
    ).toThrow(ForbiddenException);

    expect(customFields.create).not.toHaveBeenCalled();
  });

  it('allows public field creation for an active system_admin', async () => {
    const customFields = {
      create: vi.fn().mockResolvedValue({ fieldKey: 'public_note' }),
    };
    const controller = new CustomFieldsController(customFields as never);
    const input = { isPublic: true } as CreateCustomFieldDto;

    await expect(
      controller.create(
        input,
        requestWithRoles([{ roleKey: 'system_admin', active: true }]),
      ),
    ).resolves.toEqual({ fieldKey: 'public_note' });
    expect(customFields.create).toHaveBeenCalledWith(input, {
      actorUserId: 1,
      traceId: 'server-field-trace',
      clientIp: '192.0.2.1',
      userAgent: 'field-test-agent',
    });
  });
});
