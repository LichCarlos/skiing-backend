# 独立安装与编译后 HTTP 验收

2026-11-02，在无父目录依赖、无旧 node_modules/构建产物/.env 的独立源码副本中，通过独立新 store 冻结安装、Prisma generate、完整 check（130 文件 1039 项）和 Nest build。23 项迁移、双 seed、测试前后 db:verify 通过；`node dist/main.js` 真实运行，新增 4 项 HTTP 验收通过。

## 独立复现

按本仓 [README](../../README.md) 配置 Node/pnpm。仅创建一次性 PostgreSQL 17/pgvector 数据库 `linji_isolated_validation`，不要把以下验收指向已有业务数据库。各终端独立配置环境，不依赖兄弟仓库文件或启动器。

```powershell
pnpm install --frozen-lockfile --store-dir D:/linji-validation-store/backend
pnpm db:generate
pnpm check
pnpm build

$env:DATABASE_URL='postgresql://<测试用户>:<测试密码>@127.0.0.1:62411/linji_isolated_validation'
$env:INITIAL_ADMIN_ACCOUNT='isolated_admin'
$env:INITIAL_ADMIN_PASSWORD='<8至72字节的测试密码>'
pnpm db:deploy
pnpm db:seed
pnpm db:seed
pnpm db:verify
```

配置 JWT_ACCESS_SECRET 为至少 32 字符的临时随机值，WEB_ORIGINS 包含 `http://localhost:62400,http://localhost:62401`，PORT=62410；本次基本 HTTP 验收 OUTBOX_DISPATCH_ENABLED=false、KAFKA_CONSUMER_ENABLED=false。使用刚构建的 `node dist/main.js` 启动生产进程，另一个终端保留相同 DATABASE_URL：

```powershell
$env:ISOLATED_DATABASE_NAME='linji_isolated_validation'
$env:ISOLATED_API_BASE_URL='http://localhost:62410/api/v1'
$env:ISOLATED_ADMIN_ORIGIN='http://localhost:62401'
$env:ISOLATED_ADMIN_ACCOUNT='isolated_admin'
$env:ISOLATED_ADMIN_PASSWORD='<与seed相同的测试密码>'
pnpm test:independent-http
pnpm db:verify
```

验收进程同样需要 INITIAL_ADMIN_ACCOUNT/PASSWORD，db:verify 会检查 seed 管理员；脚本本身读取 ISOLATED_ADMIN_ACCOUNT/PASSWORD。账号必须以 `isolated_` 开头，所有服务地址限回环、数据库名及显式确认标记必须匹配。脚本创建合成注册账号、会话并重置其密码；完成后销毁自己的测试数据库，不能把它作为日常运行数据。

## 覆盖及限制

[脚本](../../scripts/independent-start-http.ts)对真实编译后服务检查公开查询、401、Cookie 属性/JSON token 剥离、CSRF、注册不自动登录、普通账号 403、管理员汇总、密码重置 204、全部旧会话撤销及数据库审计。Node 手动传 Cookie 不代表浏览器实际接受 Secure Cookie；Next 浏览器流程未执行。Kafka/供应商/存储没有启动，未重跑历史完整数据库/HTTP套件。

原始日志为本地忽略文件 `isolated-start-install.log`、`isolated-start-check-build.log`、`isolated-start-final-check.log`、`isolated-start-http.log`、`isolated-start-database*.log`。初次验收脚本 lint 和缺少 seed 参数的 db:verify 失败已修正，最终复验通过。OpenAPI 1.50.0/143 操作不变，无新依赖、migration 或产品接口。
