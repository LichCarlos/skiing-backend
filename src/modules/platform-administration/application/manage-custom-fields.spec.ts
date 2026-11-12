import { describe, expect, it, vi } from 'vitest';
import type { CustomFieldRepository } from './ports/custom-field-repository.js';
import { ManageCustomFields } from './manage-custom-fields.js';
import { CustomFieldAuthorizationError } from '../domain/custom-field-audit.js';

const audit = {
  actorUserId: 1,
  traceId: 'field-test',
  clientIp: null,
  userAgent: null,
};

const definition = {
  fieldDefinitionId: 4,
  entityType: 'ski_resort',
  fieldKey: 'lift_count',
  label: '缆车数量',
  dataType: 'integer',
  groupKey: 'facilities',
  sortOrder: 0,
  required: false,
  defaultValue: null,
  optionsDictType: null,
  validation: null,
  searchable: false,
  filterable: false,
  sortable: false,
  isPublic: false,
  status: 'draft' as const,
  schemaVersion: 1,
  createTime: new Date('2026-01-01T00:00:00.000Z'),
  updateTime: new Date('2026-01-01T00:00:00.000Z'),
};

function createRepository(overrides: Partial<CustomFieldRepository> = {}) {
  return {
    listDefinitions: vi.fn(),
    findDefinitionById: vi.fn(async () => definition),
    createDefinition: vi.fn(async () => definition),
    updateDefinition: vi.fn(async () => definition),
    setDefinitionStatus: vi.fn(async () => ({
      ...definition,
      status: 'active' as const,
      schemaVersion: 2,
    })),
    listGroups: vi.fn(),
    findGroup: vi.fn(async () => ({
      entityType: 'ski_resort',
      groupKey: 'facilities',
      label: '设施',
      sortOrder: 0,
      visibilityRule: null,
      status: 'active' as const,
      createTime: definition.createTime,
      updateTime: definition.updateTime,
    })),
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    disableGroup: vi.fn(async () => true),
    isActiveDictionaryType: vi.fn(async () => true),
    listActiveDictionaryValues: vi.fn(async () => new Set<string>()),
    findActiveSchema: vi.fn(),
    ...overrides,
  } as unknown as CustomFieldRepository;
}

describe('ManageCustomFields', () => {
  it('maps transaction authorization rejection to HTTP 403', async () => {
    const createGroup = vi
      .fn()
      .mockRejectedValue(
        new CustomFieldAuthorizationError(
          'Custom field write permission is unavailable',
        ),
      );
    const service = new ManageCustomFields(createRepository({ createGroup }));
    await expect(
      service.createGroup(
        {
          entityType: 'article',
          groupKey: 'facilities',
          label: 'Group',
          sortOrder: 0,
        },
        audit,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(createGroup).toHaveBeenCalledOnce();
  });

  it('reads a disabled group by the exact entity and key without mutating it', async () => {
    const group = {
      entityType: 'article',
      groupKey: 'facilities',
      label: 'Group',
      sortOrder: 1,
      visibilityRule: null,
      status: 'disabled' as const,
      createTime: definition.createTime,
      updateTime: definition.updateTime,
    };
    const findGroup = vi.fn(async () => group);
    const createGroup = vi.fn(),
      updateGroup = vi.fn(),
      disableGroup = vi.fn();
    const service = new ManageCustomFields(
      createRepository({
        findGroup,
        createGroup,
        updateGroup,
        disableGroup,
      }),
    );
    expect(await service.getGroup('article', 'facilities')).toEqual(group);
    expect(findGroup).toHaveBeenCalledExactlyOnceWith('article', 'facilities');
    expect(createGroup).not.toHaveBeenCalled();
    expect(updateGroup).not.toHaveBeenCalled();
    expect(disableGroup).not.toHaveBeenCalled();
  });

  it('returns 404 for an absent composite group key', async () => {
    const service = new ManageCustomFields(
      createRepository({
        findGroup: vi.fn(async () => null),
      }),
    );
    await expect(service.getGroup('article', 'missing')).rejects.toMatchObject({
      status: 404,
    });
  });

  it.each([
    ['unknown', 'facilities'],
    ['ski_resort', 'Uppercase'],
    ['ski_resort', 'bad.key'],
    ['ski_resort', 'has space'],
    ['ski_resort', ''],
    ['ski_resort', 'a'.repeat(101)],
  ])(
    'rejects invalid group identity %s / %s before querying',
    async (entityType, groupKey) => {
      const findGroup = vi.fn();
      const service = new ManageCustomFields(createRepository({ findGroup }));
      await expect(
        service.getGroup(entityType, groupKey),
      ).rejects.toMatchObject({ status: 400 });
      expect(findGroup).not.toHaveBeenCalled();
    },
  );

  it('maps serializable write conflicts to HTTP 409', async () => {
    const repository = createRepository({
      updateDefinition: vi.fn().mockRejectedValue({ code: 'P2034' }),
    });
    await expect(
      new ManageCustomFields(repository).update(
        {
          fieldDefinitionId: 4,
          expectedSchemaVersion: 1,
          patch: { label: 'Updated' },
        },
        audit,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('creates definitions in draft after validating their group and schema', async () => {
    const createDefinition = vi.fn(async () => definition);
    const repository = createRepository({ createDefinition });
    const service = new ManageCustomFields(repository);

    const result = await service.create(
      {
        entityType: 'ski_resort',
        fieldKey: 'lift_count',
        label: '缆车数量',
        dataType: 'integer',
        groupKey: 'facilities',
        sortOrder: 0,
        required: false,
        searchable: false,
        filterable: false,
        sortable: false,
        isPublic: false,
      },
      audit,
    );

    expect(createDefinition).toHaveBeenCalledWith(
      expect.objectContaining({ fieldKey: 'lift_count' }),
      audit,
    );
    expect(result.status).toBe('draft');
  });

  it('activates with optimistic version checks and requires an active group', async () => {
    const setDefinitionStatus = vi.fn(async () => ({
      ...definition,
      status: 'active' as const,
      schemaVersion: 2,
    }));
    const repository = createRepository({ setDefinitionStatus });
    const service = new ManageCustomFields(repository);

    await expect(
      service.activate(
        { fieldDefinitionId: 4, expectedSchemaVersion: 2 },
        audit,
      ),
    ).rejects.toThrow('Custom field schema version is stale');
    expect(setDefinitionStatus).not.toHaveBeenCalled();
  });

  it('does not deactivate a group while it still contains active definitions', async () => {
    const repository = createRepository({
      disableGroup: vi.fn(async () => false),
    });
    const service = new ManageCustomFields(repository);

    await expect(
      service.disableGroup('ski_resort', 'facilities', audit),
    ).rejects.toThrow('Group is missing or still contains active fields');
  });
});
