# AI 管理浏览器验收夹具

日期：2026-11-02。契约仍为 OpenAPI 1.49.0 / 142 个操作。本工具只准备和核对合成数据，不承担 Web 浏览器测试。脚本为 [ai-browser-fixture.ts](../../scripts/ai-browser-fixture.ts)。

## 环境边界

必须使用新建、可丢弃的 loopback PostgreSQL/pgvector 数据库，名称匹配 `linji_browser_validation_*`；`AI_BROWSER_FIXTURE_CONFIRM` 必须与库名完全一致。`create` 还要求数据库只有 seed 管理员，且没有 RAG 或会话记录。已有 manifest 会拒绝再次创建。不得对开发/生产数据使用此工具。

本轮专用容器为 `linji-browser-validation-1793586198654`，ID `e802c9b980bab65728d317b6a88c9bae21e9750f8ded1312fbbf4d62e91d5832`，标签 `linji.task=ai-browser-validation`，`AutoRemove=true`；loopback 端口 60846、库名 `linji_browser_validation_ai`。这是本次环境记录，复验需创建新的隔离容器和凭证。

Backend 和 Web 均从各自仓库安装依赖，不互相导入源码或访问对方数据库。账号密码仅通过进程环境传入；manifest 只含合成账号和测试数据，不含密码。示例环境变量中的密码需使用专用测试值。

## 准备与运行

先为新的隔离库设置 `DATABASE_URL`，设置 `INITIAL_ADMIN_ACCOUNT`、`INITIAL_ADMIN_PASSWORD` 和 `AI_BROWSER_FIXTURE_PASSWORD`；本浏览器套件使用同一测试密码登录 seed 管理员和合成账号，所以后两个密码应相同。保持标准 Cookie/CSRF 配置。

```powershell
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm db:verify
$env:AI_BROWSER_FIXTURE_CONFIRM='linji_browser_validation_ai'
pnpm exec tsx scripts/ai-browser-fixture.ts create
pnpm build
$env:JWT_ACCESS_SECRET='isolated-browser-validation-at-least-32-characters'
$env:WEB_ORIGINS='http://localhost:3001'
$env:PORT='18080'
$env:KAFKA_CONSUMER_ENABLED='false'
$env:OUTBOX_DISPATCH_ENABLED='false'
pnpm start:prod
```

终端保留服务进程。在独立终端启动 Web Admin，并按其 `docs/engineering/ai-browser-validation.md` 传递 manifest JSON 和测试密码运行浏览器套件。夹具固定使用确定性 1024 维向量创建公开雪场索引，完全不调用模型供应商。

## 核对与清理

浏览器完整套件结束后，在另一个 Backend 终端设置相同隔离库、确认变量及 `INITIAL_ADMIN_ACCOUNT`（结构校验会使用）：

```powershell
pnpm exec tsx scripts/ai-browser-fixture.ts verify
```

`verify` 断言六种正文读取原因的成功审计存在、五种来源控制原因的成功审计存在、409 操作没有成功控制审计；审计不含合成私有问答。最终来源应为人工停用、disabled、零分块，并至少有三个重建 Outbox 事件。允许套件重复运行，所以不按固定累计事件数断言。浏览器重建只验证排队受理，worker 关闭时不会完成索引。

完成证据保存后，先停止本次自建 Web/Backend 服务，再执行：

```powershell
pnpm exec tsx scripts/ai-browser-fixture.ts cleanup
pnpm db:verify
```

清理只针对 manifest 指定的合成用户/角色、会话、雪场、RAG、Outbox/Inbox 和操作审计，并移除 manifest；保留 seed 管理员和内置角色。登录 seed 管理员产生的 AuthSession 会随隔离容器销毁，不将其混同业务夹具。停止容器前核验完整 ID、名称、标签和 AutoRemove，只停止本次创建的容器。

## 证据范围

本轮真实 Next/Nest/Guard/Cookie/CSRF/PostgreSQL 与 Playwright Chromium 验收 8 项通过，另有数据库断言通过。首次两轮分别因 Ant Design 登录文字间距和 refresh Cookie 路径的测试定位失败，修正测试后通过；日志保留。没有修改生产鉴权规则。页面生命周期和响应丢失采用浏览器网络/事件注入；不能替代 OS 隐藏、原生设备、真实模型/Kafka 和生产故障恢复验证。

最终后端冻结安装、lint/typecheck、1017项单测、126项HTTP与build通过。浏览器复跑另修正React事件后DOM提交的测试等待，最终8项通过。清理后db:verify首次因新终端漏传INITIAL_ADMIN_ACCOUNT失败，补齐环境后23迁移/15索引/18约束校验通过，失败日志保留。seed用户1个/角色3个保留，业务/会话/RAG/事件/审计全为0；18条seed管理员测试登录会话随专用容器销毁。服务及该容器已按身份核验后停止/自动移除，其他五个容器保留。
