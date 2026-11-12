# Expo Web 认证协议真实 HTTP 与持久化验收

2026-11-02；后端业务接口及 OpenAPI1.50.0/143操作保持，23项 migration 未变。新增本仓可销毁夹具脚本；Expo 本仓的 Web Cookie transport/auth 调用编译后的 Nest 与 PostgreSQL17/pgvector，独立 HTTP **5项通过**。

验证注册不自动登录、允许 Origin/CORS 响应、CSRF 双提交、HttpOnly Secure SameSite=Lax Cookie 与响应不返回令牌、并发访问过期只刷新一次、真实 CSRF 403 后重取、资料更新、本人改密撤销全部会话（包含额外创建的原生会话）、普通退出、丢弃已提交退出/刷新响应后客户端不重放。只有浏览器 API 和 Cookie 容器使用测试替身；未模拟 API 成功或绕过后端 Guard。

持久断言确认两个账号（含 seed）、目标昵称及新密码哈希、至少三个已撤销会话和两次已消费 refresh。最后故意丢弃成功刷新响应，数据库仍有一个活动会话；客户端将其停用而非宣称服务端撤销。新库23迁移、双 seed、前后 `db:verify` 通过。完整Backend130文件1039项/check/build通过；本轮没有重跑历史完整数据库/HTTP套件。

## 独立复现

本仓冻结安装、生成 Prisma、检查及构建后，新建自己的空 PostgreSQL17/pgvector 专用库 `linji_expo_web_validation`，仅绑定回环62951。设置 `DATABASE_URL`、合成 `INITIAL_ADMIN_ACCOUNT/INITIAL_ADMIN_PASSWORD`，执行 `pnpm db:deploy`、两次 `pnpm db:seed`、`pnpm db:verify`，然后：

```powershell
$env:EXPO_WEB_FIXTURE_CONFIRM='linji_expo_web_validation'
pnpm exec tsx scripts/expo-web-auth-http-fixture.ts prepare
```

[脚本](../../scripts/expo-web-auth-http-fixture.ts)要求回环主机、专用库名和确认值，且只有 seed 用户、无会话；清单写入忽略的 `storage/expo-web-auth-http-fixture.json`，不包含密码。启动编译后 API 时设置：

```powershell
$env:PORT='62950'
$env:WEB_ORIGINS='http://localhost:62952'
$env:JWT_ACCESS_SECRET='<至少32字符的临时随机值>'
$env:OUTBOX_DISPATCH_ENABLED='false'
$env:KAFKA_CONSUMER_ENABLED='false'
node dist/main.js
```

向客户端负责人交付清单及两个不同的合成密码；客户端独立运行 `pnpm test:expo-web-http`。完成后以同一数据库、确认值和 seed 环境执行：

```powershell
$env:EXPO_WEB_FIXTURE_REPLACEMENT='<客户端使用的新密码>'
pnpm exec tsx scripts/expo-web-auth-http-fixture.ts verify
pnpm db:verify
```

失败重跑需重建专用库，不删除业务数据。真实浏览器 Expo 开发服务启动被自动审批审查拒绝，仅返回 blocked by policy；本轮没有浏览器点击验收，也不将测试 Cookie 容器视为浏览器的 CORS、Secure、SameSite 或跨标签页执行证据。前端部署条件由其 README 定义；同 Origin `/auth/csrf` 与跨 Origin 共享 Cookie 的并发切换尚未支持或验收。

本轮 API PID33604、专用容器 linji-expo-web-20261102 及其匿名数据卷已按进程命令/父PID、容器ID和标签核实后清理；62950/62951/62952 无监听，原五个无关容器保留。未提交、推送或部署。
