import { parseArticleMarkdown } from '../../../shared/content/markdown.js';
import { describe, expect, it, vi } from 'vitest';
import { AdminArticleService } from './admin-article-service.js';
import type {
  ArticleRepository,
  ArticleTransaction,
  ArticleReadSession,
  ArticleFieldContext,
} from './ports/article-repository.js';
import type { AssetStorage } from '../../assets/application/ports/asset-storage.js';
import { articleRecord } from '../../../../test/fixtures/content-records.js';

const scope = { kind: 'all' } as const;
const audit = {
  actorUserId: 3,
  traceId: 'trace',
  clientIp: null,
  userAgent: null,
};
const body = {
  title: 'Ski basics',
  summary: 'Summary',
  body: 'Body',
  categoryValue: 'basics',
  coverAssetId: '91',
};
function setup() {
  let row = articleRecord();
  const order: string[] = [];
  const fields: ArticleFieldContext = {
    definitions: [],
    policies: new Map(),
    dictionaryValues: new Map(),
    groups: [],
  };
  const tx = {
    fields,
    findPage: vi.fn(async () => ({ items: [{ ...row }], total: 1 })),
    find: vi.fn(async () => ({ ...row })),
    assertReferences: vi.fn(async () => {
      order.push('references');
    }),
    create: vi.fn(async () => {
      order.push('create');
      return { ...row, status: 'draft' as const };
    }),
    update: vi.fn(async (_id, _version, change) => {
      order.push('write');
      row = {
        ...row,
        ...change.values,
        ...(change.status ? { status: change.status } : {}),
        ...(change.publishTime ? { publishTime: change.publishTime } : {}),
        version: row.version + 1,
      };
      return true;
    }),
    appendChanged: vi.fn(async () => {
      order.push('event');
    }),
    audit: vi.fn(async () => {
      order.push('audit');
    }),
  } satisfies ArticleTransaction;
  const repository = {
    async runRead<T>(
      _access: import('../domain/article-scope.js').ArticleAccess,
      _actorUserId: number,
      work: (tx: ArticleReadSession) => Promise<T>,
    ): Promise<T> {
      return work(tx);
    },
    async runWrite<T>(
      _access: import('../domain/article-scope.js').ArticleAccess,
      _actorUserId: number,
      work: (tx: ArticleTransaction) => Promise<T>,
    ): Promise<T> {
      return work(tx);
    },
  } satisfies ArticleRepository;
  const storage = {
    createReadUrl: vi.fn(async () => {
      order.push('sign');
      return 'signed';
    }),
  };
  return {
    service: new AdminArticleService(
      repository,
      storage as unknown as AssetStorage,
      { parse: parseArticleMarkdown },
    ),
    repository,
    tx,
    order,
    storage,
    fields,
    setRow: (patch: Partial<typeof row>) => {
      row = { ...row, ...patch };
    },
  };
}
describe('AdminArticleService application ports', () => {
  function withFields() {
    const state = setup();
    state.fields.definitions = ['readOnly', 'writeOnly', 'secret'].map(
      (fieldKey) => ({
        fieldKey,
        dataType: 'text',
        status: 'active',
        required: false,
        schemaVersion: 7,
      }),
    );
    state.fields.policies = new Map([
      ['readOnly', { canRead: true, canWrite: false }],
      ['writeOnly', { canRead: false, canWrite: true }],
    ]);
    state.setRow({
      customFields: {
        readOnly: 'visible',
        writeOnly: 'old',
        secret: 'preserve',
        orphan: 'legacy',
      },
    });
    state.fields.groups = [
      {
        groupKey: 'general',
        label: 'General',
        sortOrder: 0,
        fields: state.fields.definitions.map((field, index) => ({
          ...field,
          fieldDefinitionId: index + 1,
          label: field.fieldKey,
          groupKey: 'general',
          sortOrder: index,
          defaultValue: null,
          optionsDictType: null,
          validation: field.validation ?? null,
        })),
      },
      {
        groupKey: 'private',
        label: 'Private',
        sortOrder: 1,
        fields: [
          {
            fieldDefinitionId: 9,
            fieldKey: 'privateOnly',
            label: 'Hidden metadata',
            dataType: 'text',
            groupKey: 'private',
            sortOrder: 0,
            required: false,
            defaultValue: null,
            optionsDictType: null,
            validation: null,
            schemaVersion: 1,
          },
        ],
      },
    ];
    return state;
  }
  it('returns only granted metadata and removes empty private groups', async () => {
    const { service } = withFields();
    const schema = await service.customFieldSchema(scope, 3);
    expect(schema.entityType).toBe('article');
    expect(schema.groups).toHaveLength(1);
    expect(
      schema.groups[0]!.fields.map((field) => [
        field.fieldKey,
        field.canRead,
        field.canWrite,
      ]),
    ).toEqual([
      ['readOnly', true, false],
      ['writeOnly', false, true],
    ]);
  });
  it('filters list and detail by field grants even with all data scope', async () => {
    const { service } = withFields();
    expect((await service.get(19, scope, 3)).customFields).toEqual({
      readOnly: 'visible',
    });
    expect((await service.list({}, scope, 3)).items[0]!.customFields).toEqual({
      readOnly: 'visible',
    });
  });
  it.each(['readOnly', 'secret', 'unknown'])(
    'rejects unauthorized or unknown field %s without persistence or events',
    async (key) => {
      const { service, tx, storage } = withFields();
      await expect(
        service.update(
          19,
          { ...body, customFields: { [key]: 'overwrite' } },
          audit,
          scope,
        ),
      ).rejects.toMatchObject({ status: 422 });
      expect(tx.update).not.toHaveBeenCalled();
      expect(tx.appendChanged).not.toHaveBeenCalled();
      expect(tx.audit).not.toHaveBeenCalled();
      expect(storage.createReadUrl).not.toHaveBeenCalled();
    },
  );
  it('permits write-only updates, preserves unreadable values, and never echoes write-only data', async () => {
    const { service, tx } = withFields();
    const result = await service.update(
      19,
      { ...body, customFields: { writeOnly: 'new' } },
      audit,
      scope,
    );
    expect(tx.update).toHaveBeenCalledWith(19, 2, {
      values: expect.objectContaining({
        customFields: {
          readOnly: 'visible',
          writeOnly: 'new',
          secret: 'preserve',
          orphan: 'legacy',
        },
        schemaVersion: 7,
      }),
    });
    expect(result.customFields).toEqual({ readOnly: 'visible' });
  });
  it.each([null, [], 'invalid', 42, false])(
    'rejects invalid customFields container %j for create/update before effects',
    async (customFields) => {
      const { service, tx } = withFields();
      const input = {
        ...body,
        customFields: customFields as unknown as Record<string, unknown>,
      };
      await expect(service.create(input, audit, scope)).rejects.toMatchObject({
        status: 422,
      });
      await expect(
        service.update(19, input, audit, scope),
      ).rejects.toMatchObject({ status: 422 });
      for (const method of [
        tx.assertReferences,
        tx.create,
        tx.update,
        tx.appendChanged,
        tx.audit,
      ])
        expect(method).not.toHaveBeenCalled();
    },
  );
  it('allows null for an optional writable field while omitted fields preserve stored values', async () => {
    const { service, tx } = withFields();
    await service.update(
      19,
      { ...body, customFields: { writeOnly: null } },
      audit,
      scope,
    );
    expect(tx.update).toHaveBeenCalledWith(19, 2, {
      values: expect.objectContaining({
        customFields: {
          readOnly: 'visible',
          writeOnly: null,
          secret: 'preserve',
          orphan: 'legacy',
        },
      }),
    });
  });
  it.each(['create', 'publish', 'withdraw'] as const)(
    'filters the %s response with the transaction policy',
    async (command) => {
      const { service, tx } = withFields();
      if (command === 'publish') {
        tx.find.mockResolvedValueOnce(articleRecord({ status: 'draft' }));
      }
      const result =
        command === 'create'
          ? await service.create(body, audit, scope)
          : await service[command](19, audit, scope);
      expect(result.customFields).toEqual({ readOnly: 'visible' });
    },
  );
  it('validates dictionary selections using the transaction context', async () => {
    const { service, fields, tx } = withFields();
    fields.definitions = [
      {
        fieldKey: 'level',
        dataType: 'single_select',
        status: 'active',
        required: false,
        schemaVersion: 9,
        optionsDictType: 'knowledge.level',
      },
    ];
    fields.policies = new Map([['level', { canRead: true, canWrite: true }]]);
    fields.dictionaryValues = new Map([
      ['knowledge.level', new Set(['beginner'])],
    ]);
    await expect(
      service.create(
        { ...body, customFields: { level: 'disabled' } },
        audit,
        scope,
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(tx.create).not.toHaveBeenCalled();
    await service.create(
      { ...body, customFields: { level: 'beginner' } },
      audit,
      scope,
    );
    expect(tx.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customFields: { level: 'beginner' },
        schemaVersion: 9,
      }),
      3,
    );
  });
  it.each([
    undefined,
    { kind: 'merchant', merchantId: 8 },
    { kind: 'selected', ids: [] },
    { kind: 'self', userId: 2147483648 },
    { kind: 'selected', ids: [19, 2147483648] },
  ] as const)(
    'rejects unsupported scope before any repository or field access: %j',
    async (denied) => {
      const { service, tx, storage } = setup();
      for (const run of [
        () => service.list({}, denied, 3),
        () => service.customFieldSchema(denied, 3),
        () => service.get(19, denied, 3),
        () => service.create(body, audit, denied),
        () => service.update(19, body, audit, denied),
        () => service.remove(19, audit, denied),
        () => service.publish(19, audit, denied),
        () => service.withdraw(19, audit, denied),
      ])
        await expect(run()).rejects.toMatchObject({ status: 403 });
      expect(tx.find).not.toHaveBeenCalled();
      expect(tx.findPage).not.toHaveBeenCalled();
      expect(tx.find).not.toHaveBeenCalled();
      expect(tx.assertReferences).not.toHaveBeenCalled();
      expect(storage.createReadUrl).not.toHaveBeenCalled();
    },
  );
  it.each([0, -1, 2147483648])(
    'rejects invalid actor %s for every operation even under all scope',
    async (actorUserId) => {
      const { service, tx } = setup();
      const invalidAudit = { ...audit, actorUserId };
      for (const run of [
        () => service.list({}, scope, actorUserId),
        () => service.customFieldSchema(scope, actorUserId),
        () => service.get(19, scope, actorUserId),
        () => service.create(body, invalidAudit, scope),
        () => service.update(19, body, invalidAudit, scope),
        () => service.remove(19, invalidAudit, scope),
        () => service.publish(19, invalidAudit, scope),
        () => service.withdraw(19, invalidAudit, scope),
      ])
        await expect(run()).rejects.toMatchObject({ status: 403 });
      for (const method of [
        tx.findPage,
        tx.find,
        tx.create,
        tx.update,
        tx.appendChanged,
        tx.audit,
      ])
        expect(method).not.toHaveBeenCalled();
    },
  );
  it('forwards self/selected scopes and rejects selected creation and mismatched self actor', async () => {
    const { service, tx } = setup();
    await service.list(
      { page: 2, pageSize: 3 },
      { kind: 'self', userId: 3 },
      3,
    );
    expect(tx.findPage).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 3, take: 3 }),
    );
    await service.get(19, { kind: 'selected', ids: [19, 20] }, 3);
    expect(tx.find).toHaveBeenCalledWith(19);
    await expect(
      service.create(body, audit, { kind: 'selected', ids: [19] }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.create(body, audit, { kind: 'self', userId: 4 }),
    ).rejects.toMatchObject({ status: 403 });
    expect(tx.create).not.toHaveBeenCalled();
  });
  it('returns 404 for targets hidden by the repository scope before writing', async () => {
    const { service, tx } = setup();
    tx.find.mockResolvedValueOnce(null as never);
    await expect(
      service.update(20, body, audit, { kind: 'self', userId: 3 }),
    ).rejects.toMatchObject({ status: 404 });
    expect(tx.update).not.toHaveBeenCalled();
    tx.find.mockResolvedValueOnce(null as never);
    await expect(
      service.publish(20, audit, { kind: 'selected', ids: [19] }),
    ).rejects.toMatchObject({ status: 404 });
    expect(tx.appendChanged).not.toHaveBeenCalled();
  });
  it('keeps published status and publication date when editing and audits before signing', async () => {
    const { service, tx, order } = setup();
    await expect(service.update(19, body, audit, scope)).resolves.toMatchObject(
      {
        status: 'published',
        publishTime: '2026-10-01T00:00:00.000Z',
        version: 3,
      },
    );
    expect(tx.update).toHaveBeenCalledWith(19, 2, {
      values: expect.objectContaining({
        title: 'Ski basics',
        coverAssetId: '91',
      }),
    });
    expect(tx.appendChanged).toHaveBeenCalledWith(19, 'published');
    expect(order).toEqual(['references', 'write', 'event', 'audit', 'sign']);
  });
  it('sets the author through the transaction actor, and creates only drafts', async () => {
    const { service, tx, order } = setup();
    await expect(service.create(body, audit, scope)).resolves.toMatchObject({
      status: 'draft',
    });
    expect(tx.create).toHaveBeenCalledWith(
      expect.objectContaining({ categoryValue: 'basics' }),
      3,
    );
    expect(order).toEqual(['references', 'create', 'event', 'audit', 'sign']);
  });
  it('rejects a stale version before event, audit and URL signing', async () => {
    const { service, tx, storage } = setup();
    tx.update.mockResolvedValueOnce(false);
    await expect(service.update(19, body, audit, scope)).rejects.toMatchObject({
      status: 409,
    });
    expect(tx.appendChanged).not.toHaveBeenCalled();
    expect(tx.audit).not.toHaveBeenCalled();
    expect(storage.createReadUrl).not.toHaveBeenCalled();
  });
  it('does not write when a transactional reference is no longer valid', async () => {
    const { service, tx } = setup();
    tx.assertReferences.mockRejectedValueOnce(new Error('not ready'));
    await expect(service.update(19, body, audit, scope)).rejects.toThrow(
      'not ready',
    );
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.appendChanged).not.toHaveBeenCalled();
  });
  it('rejects unknown custom fields and malformed asset IDs before persistence', async () => {
    const { service, tx } = setup();
    await expect(
      service.create(
        { ...body, customFields: { internalSecret: 'bad' } },
        audit,
        scope,
      ),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      service.create({ ...body, coverAssetId: 'not-an-id' }, audit, scope),
    ).rejects.toMatchObject({ status: 422 });
    expect(tx.assertReferences).not.toHaveBeenCalled();
    expect(tx.create).not.toHaveBeenCalled();
  });
  it('preserves the original first publication time when republishing withdrawn content', async () => {
    const { service, tx } = setup();
    tx.find.mockResolvedValueOnce(articleRecord({ status: 'withdrawn' }));
    await service.publish(19, audit, scope);
    expect(tx.update).toHaveBeenCalledWith(19, 2, {
      status: 'published',
      publishTime: new Date('2026-10-01T00:00:00Z'),
    });
  });
  it('does not sign a response if the audit append fails', async () => {
    const { service, tx, storage } = setup();
    tx.audit.mockRejectedValueOnce(new Error('audit failed'));
    await expect(service.withdraw(19, audit, scope)).rejects.toThrow(
      'audit failed',
    );
    expect(storage.createReadUrl).not.toHaveBeenCalled();
  });
});

describe('Article Markdown versioning', () => {
  it('saves Markdown without changing published state and retains transaction order', async () => {
    const { service, tx, order } = setup();
    const result = await service.update(
      19,
      {
        ...body,
        body: '## 安全',
        contentFormat: 'markdown_v1',
        expectedVersion: 2,
      },
      audit,
      scope,
    );
    expect(result).toMatchObject({
      contentFormat: 'markdown_v1',
      status: 'published',
      version: 3,
    });
    expect(tx.assertReferences).toHaveBeenCalled();
    expect(order.slice(0, 4)).toEqual([
      'references',
      'write',
      'event',
      'audit',
    ]);
  });
  it.each([
    { contentFormat: 'markdown_v1' as const },
    { contentFormat: 'markdown_v1' as const, expectedVersion: 1 },
  ])('rejects missing or stale conversion versions', async (patch) => {
    const { service, tx } = setup();
    await expect(
      service.update(19, { ...body, ...patch }, audit, scope),
    ).rejects.toThrow();
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.appendChanged).not.toHaveBeenCalled();
  });
  it('never silently downgrades a Markdown article', async () => {
    const { service, tx, setRow } = setup();
    setRow({ contentFormat: 'markdown_v1' });
    await expect(
      service.update(
        19,
        { ...body, contentFormat: 'plain_text', expectedVersion: 2 },
        audit,
        scope,
      ),
    ).rejects.toThrow('downgraded');
    expect(tx.update).not.toHaveBeenCalled();
  });
  it('rejects unsafe syntax before references or mutation', async () => {
    const { service, tx } = setup();
    await expect(
      service.create(
        {
          ...body,
          body: '![x](https://internal.test/private)',
          contentFormat: 'markdown_v1',
        },
        audit,
        scope,
      ),
    ).rejects.toThrow();
    expect(tx.create).not.toHaveBeenCalled();
    expect(tx.assertReferences).not.toHaveBeenCalled();
  });
  it('signs body assets only on read and never replaces persistent IDs', async () => {
    const { service, setRow, storage } = setup();
    setRow({
      contentFormat: 'markdown_v1',
      body: '![x](asset:12)',
      bodyAssets: [{ assetId: '12', storageKey: 'private-body' }],
    });
    const result = await service.get(19, scope, 3);
    expect(result.body).toBe('![x](asset:12)');
    expect(result.bodyAssets).toEqual([{ assetId: '12', url: 'signed' }]);
    expect(storage.createReadUrl).toHaveBeenCalledWith('private-body', 900);
  });
});
