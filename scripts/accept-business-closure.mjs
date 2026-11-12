import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile, access, unlink } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(root + 'package.json');
require('reflect-metadata');
const { PrismaClient } = require('@prisma/client');
const { NestFactory } = require('@nestjs/core');
const load = (path) => import(pathToFileURL(root + 'dist/' + path).href);
const database = new URL(process.env.DATABASE_URL).pathname.slice(1);
assert.equal(
  process.env.BUSINESS_CLOSURE_CONFIRM,
  database,
  'Explicit disposable database confirmation required',
);
assert.equal(database, 'linji_asset_storage_validation');
assert.equal(process.env.LINJI_DATABASE_TEST_DISPOSABLE, 'true');
assert(process.env.LINJI_NATIVE_API_OUTPUT?.startsWith('D:'));
const report = {
  completed: false,
  checks: [],
  models: { chat: process.env.CHAT_MODEL_NAME ?? null },
  successfulExactQueryRequests: 0,
};
const db = new PrismaClient();
const app = await NestFactory.create((await load('app.module.js')).AppModule, {
  logger: ['error', 'warn'],
});
(await load('shared/http/configure-http.js')).configureHttp(app);
await app.listen(Number(process.env.PORT), '127.0.0.1');
const base = `http://127.0.0.1:${process.env.PORT}/api/v1`,
  secret = randomBytes(24).toString('hex'),
  prefix = 'closure_' + randomBytes(5).toString('hex');
async function check(name, effect) {
  const at = Date.now();
  try {
    await effect();
    report.checks.push({ name, passed: true, elapsedMs: Date.now() - at });
  } catch (error) {
    report.checks.push({ name, passed: false, elapsedMs: Date.now() - at });
    throw new Error(name + ' failed', { cause: error });
  }
}
async function call(
  path,
  { method = 'GET', token, body, status = 200, headers = {} } = {},
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(150000),
  });
  assert.equal(response.status, status, `${method} ${path} status`);
  if (status === 204) return null;
  const envelope = await response.json();
  return envelope.data;
}
let admin, merchant, regular, profile, merchantUser, resort, dynamic;
try {
  admin = (
    await call('/auth/login', {
      method: 'POST',
      body: {
        account: process.env.INITIAL_ADMIN_ACCOUNT,
        password: process.env.INITIAL_ADMIN_PASSWORD,
      },
      status: 200,
    })
  ).accessToken;
  const userRole = await db.role.findUniqueOrThrow({
      where: { RoleKey: 'user' },
    }),
    merchantRole = await db.role.findUniqueOrThrow({
      where: { RoleKey: 'merchant' },
    });
  await check(
    'administrator creates an account and establishes merchant business profile without granting roles implicitly',
    async () => {
      merchantUser = await call('/admin/users', {
        method: 'POST',
        token: admin,
        body: {
          account: prefix,
          nickname: '资料闭环商家',
          password: secret,
          roleIds: [userRole.RoleId],
        },
        status: 201,
      });
      const path = `/admin/users/${merchantUser.userId}/merchant-profile`;
      assert.equal(await call(path, { token: admin }), null);
      profile = await call(path, {
        method: 'POST',
        token: admin,
        body: {
          businessName: '闭环验收商家',
          contact: '验收合成联系信息',
          reason: '核对资料并建立商家身份',
        },
        status: 201,
      });
      assert.equal(profile.version, 1);
      const me = await call('/admin/users/' + merchantUser.userId, {
        token: admin,
      });
      assert.deepEqual(
        me.roles.map((r) => r.roleId),
        [userRole.RoleId],
      );
      await call(path, {
        method: 'POST',
        token: admin,
        body: { businessName: '重复资料', reason: '重复请求' },
        status: 409,
      });
      profile = await call(path, {
        method: 'PATCH',
        token: admin,
        body: { expectedVersion: 1, contact: null, reason: '清除合成联系信息' },
      });
      assert.equal(profile.contact, null);
      assert.equal(profile.version, 2);
      await call(path, {
        method: 'PATCH',
        token: admin,
        body: {
          expectedVersion: 1,
          businessName: '旧版本',
          reason: '测试冲突',
        },
        status: 409,
      });
      await call('/admin/users/' + merchantUser.userId + '/roles', {
        method: 'PUT',
        token: admin,
        body: { roleIds: [userRole.RoleId, merchantRole.RoleId] },
      });
      merchant = (
        await call('/auth/login', {
          method: 'POST',
          body: { account: prefix, password: secret },
          status: 200,
        })
      ).accessToken;
      await call(path, { token: merchant, status: 403 });
    },
  );
  await check(
    'merchant resort creation, review, administrator publishing reason and disable/enable lifecycle',
    async () => {
      resort = await call('/merchant/resorts', {
        method: 'POST',
        token: merchant,
        body: {
          name: '闭环验收低价雪场',
          price: 110,
          snowCondition: '压雪',
          openStatus: 'open',
          description: '本地验收合成资料',
        },
        status: 201,
      });
      await call(`/merchant/resorts/${resort.resortId}/submit-review`, {
        method: 'PATCH',
        token: merchant,
        body: {},
      });
      await call(`/admin/resorts/${resort.resortId}/publish`, {
        method: 'PATCH',
        token: admin,
        body: { reason: '  资料核验完成  ' },
      });
      const audit = await db.operationLog.findFirstOrThrow({
        where: {
          TargetId: String(resort.resortId),
          ActionKey: 'content:resort:publish',
        },
        orderBy: { CreateTime: 'desc' },
      });
      assert.equal(audit.Reason, '资料核验完成');
      const path = `/admin/users/${merchantUser.userId}/merchant-profile/status`;
      profile = await call(path, {
        method: 'PATCH',
        token: admin,
        body: {
          expectedVersion: profile.version,
          status: 'disabled',
          reason: '停用商家业务身份',
        },
      });
      await call('/merchant/resorts', { token: merchant, status: 403 });
      await call('/resorts/' + resort.resortId);
      profile = await call(path, {
        method: 'PATCH',
        token: admin,
        body: {
          expectedVersion: profile.version,
          status: 'active',
          reason: '重新启用商家资料',
        },
      });
      assert.equal(profile.status, 'active');
    },
  );
  const fields = {};
  await check(
    'administrator configures dynamic business fields and field grants, writes validate and unknown fields are rejected',
    async () => {
      for (const entityType of ['ski_resort', 'dynamic', 'merchant_profile']) {
        await call('/admin/custom-field-groups', {
          method: 'POST',
          token: admin,
          body: {
            entityType,
            groupKey: prefix,
            label: '业务验收字段',
            sortOrder: 10,
          },
          status: 201,
        });
        let field = await call('/admin/custom-fields', {
          method: 'POST',
          token: admin,
          body: {
            entityType,
            groupKey: prefix,
            fieldKey: prefix,
            label: entityType === 'dynamic' ? '积雪深度' : '验收等级',
            dataType: 'integer',
            required: false,
            searchable: false,
            filterable: true,
            sortable: true,
            isPublic: entityType !== 'merchant_profile',
          },
          status: 201,
        });
        field = await call(
          `/admin/custom-fields/${field.fieldDefinitionId}/activate`,
          {
            method: 'PATCH',
            token: admin,
            body: { expectedSchemaVersion: field.schemaVersion },
          },
        );
        fields[entityType] = field;
      }
      await call(`/admin/users/${merchantUser.userId}/merchant-profile`, {
        method: 'PATCH',
        token: admin,
        body: {
          expectedVersion: profile.version,
          customFields: { [prefix]: 2 },
          reason: '补充商家扩展资料',
        },
      });
      // A dedicated additional role demonstrates grants are configuration, not identity branches.
      const role = await call('/admin/roles', {
        method: 'POST',
        token: admin,
        body: {
          roleKey: prefix,
          roleName: '动态扩展字段编辑',
          dataScope: 'self',
        },
        status: 201,
      });
      await call(`/admin/roles/${role.roleId}/permissions`, {
        method: 'PUT',
        token: admin,
        body: {
          permissionIds: [],
          dataScopes: [],
          fieldPolicies: [
            {
              entityType: 'dynamic',
              fieldKey: prefix,
              canRead: true,
              canWrite: true,
            },
          ],
        },
      });
      await call('/auth/register', {
        method: 'POST',
        body: {
          account: prefix + '_user',
          nickname: '动态闭环用户',
          password: secret,
        },
        status: 201,
      });
      const account = await db.user.findUniqueOrThrow({
        where: { Account: prefix + '_user' },
      });
      await call('/admin/users/' + account.UserId + '/roles', {
        method: 'PUT',
        token: admin,
        body: { roleIds: [userRole.RoleId, role.roleId] },
      });
      regular = (
        await call('/auth/login', {
          method: 'POST',
          body: { account: account.Account, password: secret },
          status: 200,
        })
      ).accessToken;
      const schema = await call('/me/dynamics/custom-fields', {
        token: regular,
      });
      assert(
        schema.groups.some((g) =>
          g.fields.some((f) => f.fieldKey === prefix && f.canWrite),
        ),
      );
      await call('/dynamics', {
        method: 'POST',
        token: regular,
        body: {
          content: '未知扩展字段测试',
          customFields: { unknown: 'invalid' },
        },
        status: 400,
      });
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/R0kAAAAASUVORK5CYII=',
        'base64',
      );
      const assetIds = [];
      for (const name of ['first.png', 'second.png']) {
        const form = new FormData();
        form.set('file', new Blob([png], { type: 'image/png' }), name);
        const response = await fetch(base + '/assets', {
          method: 'POST',
          headers: { authorization: 'Bearer ' + regular },
          body: form,
          signal: AbortSignal.timeout(45000),
        });
        assert.equal(response.status, 201);
        const uploaded = (await response.json()).data;
        assert.equal(uploaded.status, 'ready');
        assetIds.push(uploaded.assetId);
        assert.equal(
          (await call('/assets/' + uploaded.assetId, { token: regular }))
            .assetId,
          uploaded.assetId,
        );
      }
      dynamic = await call('/dynamics', {
        method: 'POST',
        token: regular,
        body: {
          content: '闭环合成动态：今日练习平行转弯',
          resortId: resort.resortId,
          imageAssetIds: [...assetIds].reverse(),
          customFields: { [prefix]: 25 },
        },
        status: 201,
      });
      const own = await call('/me/dynamics/' + dynamic.dynamicId, {
        token: regular,
      });
      assert.equal(own.customFields[prefix], 25);
      assert.deepEqual(
        own.images.map((i) => i.assetId),
        [...assetIds].reverse(),
      );
      for (const image of own.images) {
        const response = await fetch(image.url);
        assert.equal(response.status, 200);
        assert(Buffer.from(await response.arrayBuffer()).equals(png));
      }
      await call(`/admin/dynamics/${dynamic.dynamicId}/moderation`, {
        method: 'PATCH',
        token: admin,
        body: { action: 'approve', reason: '本地合成资料审核' },
      });
      await call(`/admin/resorts/${resort.resortId}`, {
        method: 'PATCH',
        token: admin,
        body: { customFields: { [prefix]: 3 } },
      });
    },
  );
  await check(
    'public SQL query and count include only published readable fields, private data and SQL injection stay isolated',
    async () => {
      const result = await call('/catalog/dynamic/query', {
        method: 'POST',
        body: {
          filters: [{ field: 'custom.' + prefix, op: 'gte', value: 20 }],
          sort: { field: 'custom.' + prefix, direction: 'desc' },
        },
      });
      assert.equal(result.total, 1);
      assert.equal(result.items[0].id, dynamic.dynamicId);
      assert.equal(result.items[0].customFields[prefix], 25);
      await call('/catalog/merchant_profile/fields', { status: 400 });
      await call('/catalog/ski_resort/query', {
        method: 'POST',
        body: { filters: [{ field: 'contact', op: 'eq', value: 'secret' }] },
        status: 400,
      });
      assert.equal(
        (
          await call('/catalog/ski_resort/query', {
            method: 'POST',
            body: { keyword: "' OR 1=1 --" },
          })
        ).total,
        0,
      );
    },
  );
  await check(
    'browser Cookie/CSRF protocol applies to the public query read command',
    async () => {
      const origin = 'http://localhost:3001';
      await call('/catalog/ski_resort/query', {
        method: 'POST',
        body: {},
        headers: { origin },
        status: 403,
      });
      const response = await fetch(base + '/auth/csrf', {
        headers: { origin },
      });
      const data = await response.json();
      const cookie = response.headers
        .getSetCookie()
        .map((v) => v.split(';')[0])
        .join('; ');
      await call('/catalog/ski_resort/query', {
        method: 'POST',
        body: {},
        headers: { origin, cookie, 'x-csrf-token': data.data.csrfToken },
      });
    },
  );
  if (process.env.CHAT_MODEL_API_KEY)
    await check(
      'real DeepSeek planner executes an exact public count; SSE and idempotent replay persist one assistant reply',
      async () => {
        const conversation = await call('/ai/conversations', {
          method: 'POST',
          token: regular,
          body: {},
          status: 201,
        });
        const clientRequestId = randomUUID(),
          body = { clientRequestId, content: '当前已发布雪场一共有多少家？' };
        const expected = (
          await call('/catalog/ski_resort/query', {
            method: 'POST',
            body: { pageSize: 1 },
          })
        ).total;
        const response = await fetch(
          `${base}/ai/conversations/${conversation.conversationId}/messages`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: 'Bearer ' + regular,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(150000),
          },
        );
        assert.equal(response.status, 200);
        const text = await response.text();
        report.successfulExactQueryRequests++;
        assert.match(text, /event: completed/);
        assert(text.includes(`共 ${expected} 条`));
        const replay = await fetch(
          `${base}/ai/conversations/${conversation.conversationId}/messages`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: 'Bearer ' + regular,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(150000),
          },
        );
        assert.match(await replay.text(), /event: completed/);
        const detail = await call(
          '/ai/conversations/' + conversation.conversationId,
          { token: regular },
        );
        assert.equal(
          detail.messages.filter((m) => m.role === 'assistant').length,
          1,
        );
      },
    );
  else
    report.checks.push({
      name: 'real DeepSeek planner',
      passed: false,
      skipped: 'chat configuration absent',
    });
  if (process.env.CHAT_MODEL_API_KEY)
    await check(
      'real DeepSeek plans a typed dynamic-field filter; private statistics are refused',
      async () => {
        const conversation = await call('/ai/conversations', {
          method: 'POST',
          token: regular,
          body: {},
          status: 201,
        });
        const send = async (content) => {
          const response = await fetch(
            `${base}/ai/conversations/${conversation.conversationId}/messages`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: 'Bearer ' + regular,
              },
              body: JSON.stringify({ clientRequestId: randomUUID(), content }),
              signal: AbortSignal.timeout(150000),
            },
          );
          assert.equal(response.status, 200);
          const text = await response.text();
          assert.match(text, /event: completed/);
          return text;
        };
        const result = await send('查询积雪深度不低于20的已发布动态');
        assert(result.includes('共 1 条'));
        assert(result.includes('积雪深度'));
        assert(result.includes('不低于20'));
        assert(result.includes('闭环合成动态'));
        report.successfulExactQueryRequests++;
        const refused = await send('统计所有商家收益一共有多少元');
        assert(refused.includes('已授权的管理页面'));
      },
    );
  await check(
    'real MinIO orphan cleanup previews, protects bound images and checkpoints idempotent deletion',
    async () => {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/R0kAAAAASUVORK5CYII=',
        'base64',
      );
      const form = new FormData();
      form.set('file', new Blob([png], { type: 'image/png' }), 'orphan.png');
      const response = await fetch(base + '/assets', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + regular },
        body: form,
      });
      assert.equal(response.status, 201);
      const orphan = (await response.json()).data;
      const orphanUrl = (
        await call('/assets/' + orphan.assetId, { token: regular })
      ).url;
      const account = await db.user.findUniqueOrThrow({
        where: { Account: prefix + '_user' },
      });
      await db.asset.updateMany({
        where: { OwnerUserId: account.UserId },
        data: { CreateTime: new Date(Date.now() - 48 * 3600000) },
      });
      const { PrismaAssetMaintenance } = await load(
        'modules/assets/infrastructure/prisma-asset-maintenance.js',
      );
      const { S3AssetStorage } = await load(
        'modules/assets/infrastructure/s3-asset-storage.js',
      );
      const maintenance = new PrismaAssetMaintenance(db, new S3AssetStorage());
      assert.equal((await maintenance.sweep({ apply: false })).candidates, 1);
      assert.equal((await fetch(orphanUrl)).status, 200);
      assert.equal((await maintenance.sweep({ apply: true })).removed, 1);
      assert.equal((await fetch(orphanUrl)).status, 404);
      const deleted = await db.asset.findUniqueOrThrow({
        where: { AssetId: BigInt(orphan.assetId) },
      });
      assert.equal(deleted.Status, 'deleted');
      assert(deleted.StorageDeletedAt);
      assert.equal(deleted.CleanupFailureCode, null);
      assert.equal((await maintenance.sweep({ apply: true })).candidates, 0);
      const own = await call('/me/dynamics/' + dynamic.dynamicId, {
        token: regular,
      });
      assert.equal(own.images.length, 2);
      for (const image of own.images)
        assert.equal((await fetch(image.url)).status, 200);
    },
  );
  report.completed = report.checks.every((c) => c.passed);
  if (report.completed && process.env.LINJI_CLOSURE_NATIVE_HOLD === 'true') {
    // Only the explicitly confirmed disposable test DB reaches this branch.
    // Credentials exist temporarily for the owned emulator driver, never logs.
    const output = process.env.LINJI_NATIVE_API_OUTPUT;
    await writeFile(
      output + '/ui-credentials.json',
      JSON.stringify({
        account: prefix + '_user',
        password: secret,
      }),
      { mode: 0o600 },
    );
    const accountId = (
      await db.user.findUniqueOrThrow({ where: { Account: prefix + '_user' } })
    ).UserId;
    await writeFile(
      output + '/ui-ready.json',
      JSON.stringify({
        ready: true,
        resortId: resort.resortId,
        dynamicId: dynamic.dynamicId,
        fieldKey: prefix,
        accountId,
      }),
    );
    const deadline = Date.now() + 25 * 60000;
    while (Date.now() < deadline) {
      try {
        await access(output + '/ui-stop');
        break;
      } catch {
        /* waiting for the owned driver */
      }
      await writeFile(
        output + '/ui-database-state.json',
        JSON.stringify(
          {
            dynamics: await db.dynamic.findMany({
              where: { AuthorId: accountId },
              select: {
                DynamicId: true,
                Content: true,
                CustomFields: true,
                Status: true,
                Images: {
                  select: { AssetId: true },
                  orderBy: { SortOrder: 'asc' },
                },
              },
              orderBy: { DynamicId: 'desc' },
              take: 5,
            }),
            assistantMessages: await db.aiMessage.count({
              where: {
                Conversation: { UserId: accountId },
                SenderRole: 'assistant',
              },
            }),
          },
          (_key, value) =>
            typeof value === 'bigint' ? value.toString() : value,
        ),
      );
      await delay(500);
    }
  }
} catch (error) {
  report.error = error.message;
  // Assertions contain routes/statuses only, never request bodies or credentials.
  report.failure =
    error.cause instanceof assert.AssertionError
      ? {
          message: error.cause.message,
          actual: error.cause.actual,
          expected: error.cause.expected,
        }
      : null;
  process.exitCode = 1;
} finally {
  await unlink(
    process.env.LINJI_NATIVE_API_OUTPUT + '/ui-credentials.json',
  ).catch((error) => {
    if (error.code !== 'ENOENT') {
      report.credentialCleanupFailed = true;
      process.exitCode = 1;
    }
  });
  await app.close();
  await db.$disconnect();
  await writeFile(
    process.env.LINJI_NATIVE_API_OUTPUT + '/api-results.json',
    JSON.stringify(report, null, 2),
  );
  console.info(
    JSON.stringify({
      completed: report.completed,
      checks: report.checks.length,
      failed: report.checks.filter((c) => !c.passed).map((c) => c.name),
    }),
  );
}
