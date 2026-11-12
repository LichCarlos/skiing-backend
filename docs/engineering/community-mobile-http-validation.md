# App 社区真实 HTTP 与持久化验收

2026-11-02，API-C01/C02/C03/C04 的既定接口续验。后端产品 API、OpenAPI 1.50.0/143 操作、依赖和 23 项 migration 未变；新增本仓一次性夹具准备/持久断言脚本。

本轮三仓冻结安装通过；Backend 完整 130 文件 1039 项、lint/typecheck 和 Nest build 通过。App 独立四项 HTTP 测试通过，使用实际 transport/auth、会话端口、提交门禁和 QueryClient，只替换 Native SecureStore。真实编译后 Nest 连接新建 PostgreSQL17/pgvector，迁移、双 seed、前后 db:verify 通过；完整历史数据库/HTTP 套件未重跑。

## 独立复现

创建自己的空 PostgreSQL17/pgvector 容器，数据库名称必须为 `linji_community_mobile_validation`，只监听回环测试端口。按 README 冻结安装、db:generate、check/build；设置专用 DATABASE_URL 和合成 INITIAL_ADMIN_ACCOUNT/INITIAL_ADMIN_PASSWORD，执行 db:deploy、两次 db:seed、db:verify。

[community-mobile-http-fixture.ts](../../scripts/community-mobile-http-fixture.ts) 同时检查回环地址、专用数据库名和显式确认值：

```powershell
$env:COMMUNITY_MOBILE_FIXTURE_CONFIRM='linji_community_mobile_validation'
pnpm exec tsx scripts/community-mobile-http-fixture.ts prepare
```

prepare 要求只有 seed 管理员且没有动态/评论，仅写本仓忽略的 `storage/community-mobile-http-fixture.json` 清单。实际合成业务数据全部由 App 测试调用正式 API 创建/审核，没有绕过产品授权仓储。另一个终端使用同一专用 DATABASE_URL：

```powershell
$env:PORT='62920'
$env:JWT_ACCESS_SECRET='<至少32字符的临时随机值>'
$env:OUTBOX_DISPATCH_ENABLED='false'
$env:KAFKA_CONSUMER_ENABLED='false'
node dist/main.js
```

向 App 负责人提供夹具 JSON、回环 API 地址、合成用户密码及专用管理员凭证，执行其独立 `pnpm test:community-http`。测试注册两个账号、建立 24 条动态，管理员审核后形成 22 条公开、一条待审核及一条隐藏。随后验证游客游标分页、点赞/越权、评论和删除；其中一次 POST 在真实提交后由客户端测试丢弃响应并抛出网络错误，复用页面门禁阻止重发。

结束后在本仓核验：

```powershell
pnpm exec tsx scripts/community-mobile-http-fixture.ts verify
pnpm db:verify
```

verify 使用同一专用库与确认值，检查两个用户及所有合成记录：24 条动态中剩余 21 条公开，动态和评论各一条软删除；21 条评论均归属原账号，丢响应内容只保存一次；唯一点赞属于原账号和该动态。db:verify 仍需与 seed 一致的 INITIAL_ADMIN_ACCOUNT/PASSWORD。此证据不意味着评论存在跨设备幂等键。

最后停止自己的 API，移除专用容器及数据卷，不清空业务库；失败或重复运行需重新创建专用空库。模型/Embedding、Kafka 投递、真实对象存储、设备交互和生产恢复不在本轮验收范围。

本地忽略日志为 `community-mobile-install.log`、`community-mobile-check.log`、`community-mobile-database.log`、`community-mobile-server.log`、`community-mobile-database-post.log`；夹具清单不随仓发布。App 保留自己的测试和配置，不导入后端源码或连接数据库。

本轮 API PID39180 已停止，专用容器及数据卷已移除，62920/62921 无监听；原有五个无关容器保留。
