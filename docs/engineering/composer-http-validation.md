# App 动态发布编辑：真实 HTTP、扫描与持久化验收

2026-11-02；APP-03/API-C02 既定契约续验。产品 API、OpenAPI 1.50.0/143 操作、依赖与 23 项 migration 未变。新增本仓一次性存储 HTTP 夹具和后端持久断言脚本，App 保留自己的测试，不导入后端源码或数据库。

## 结果与边界

三仓冻结安装通过；Backend 完整 130 文件 1039 项、lint/typecheck 和 Nest build 通过。App 独立 HTTP 四项通过，使用实际认证/请求端口/发布控制器，连接编译后的 Nest、真实 PostgreSQL17/pgvector 和 ClamAV 1.4.3。数据库 23 项迁移、双 seed、前后 db:verify 通过。

验证两张图片扫描后创建 pending 动态，管理员批准后作者编辑：仅上传一张新图、保留第二张原图、图片有序引用、雪场解绑并进入 pending。客户端先核对最新详情，发现外部修改会阻断旧草稿，明确重载后可保存；此预检没有消除读取与写入间的竞态，PATCH 当前没有版本前置条件。

他人本人详情 404、旧 epoch 请求前拒绝已验。另一次创建在数据库已提交后故意丢弃响应，客户端当前控制器拒绝再次发送，包括失焦再返回。后端最终断言两条 pending 动态、准确正文和图片顺序、解除雪场关联、三张同作者 ready Asset、存储 PUT 恰好三次且 DELETE 为零；丢响应创建只有一条。

Native SecureStore 使用内存替身。外部对象存储由本仓 HTTP 夹具模拟，检查 AWS Authorization 的凭证格式以及签名 URL 的 900 秒参数/签名存在，**不做签名密码学校验**。图片 multipart、Nest 资产服务、S3 SDK 请求和真实 ClamAV TCP 扫描实际执行；本证据不代表生产 S3/MinIO、过期拒绝或恶意样本验收。Outbox 调度和 Kafka 消费关闭，不宣称消息投递或 RAG 索引已在此测试执行。

## 独立复现

依 README 独立安装、生成 Prisma 并 check/build。创建自己的空 PostgreSQL17/pgvector 库 `linji_composer_validation`，仅绑定回环 62931；设置专用 DATABASE_URL、合成 INITIAL_ADMIN_ACCOUNT/INITIAL_ADMIN_PASSWORD，执行 db:deploy、两次 db:seed 和 db:verify。启动自己的 ClamAV 测试容器，回环 62933 映射 3310，等待扫描器就绪。

使用同一数据库环境启动[存储夹具](../../scripts/composer-http-fixture.ts)：

```powershell
$env:COMPOSER_FIXTURE_CONFIRM='linji_composer_validation'
pnpm exec tsx scripts/composer-http-fixture.ts serve
```

脚本同时限制数据库名、回环主机、显式确认值，要求仅有 seed 管理员且动态/资产为零；创建一个公开测试雪场并将非凭证清单写入本仓忽略的 `storage/composer-http-fixture.json`，HTTP 服务监听 127.0.0.1:62932。对象仅在内存，终止后丢失；重复验收需新建空库。

另一个终端保留同一专用数据库变量，配置测试环境：

```powershell
$env:PORT='62930'
$env:JWT_ACCESS_SECRET='<至少32字符的临时随机值>'
$env:OUTBOX_DISPATCH_ENABLED='false'
$env:KAFKA_CONSUMER_ENABLED='false'
$env:S3_ENDPOINT='http://127.0.0.1:62932'
$env:S3_PUBLIC_ENDPOINT='http://127.0.0.1:62932'
$env:S3_BUCKET='composer-fixture'
$env:S3_REGION='us-east-1'
$env:S3_ACCESS_KEY_ID='composer-local'
$env:S3_SECRET_ACCESS_KEY='<仅本地测试的合成值>'
$env:S3_SERVER_SIDE_ENCRYPTION='false'
$env:CLAMAV_HOST='127.0.0.1'
$env:CLAMAV_PORT='62933'
$env:CLAMAV_TIMEOUT_MS='15000'
node dist/main.js
```

向 App 负责人提供清单 JSON、回环 API 地址、临时合成用户密码和管理员凭证，让其在独立仓库执行 `pnpm test:composer-http`。完成后保持存储服务运行以写完统计，在本仓执行：

```powershell
pnpm exec tsx scripts/composer-http-fixture.ts verify
pnpm db:verify
```

verify 要求相同 DATABASE_URL 和确认变量；db:verify 仍需 seed 使用的管理员环境。测试结束只停止自己启动的两个服务和专用容器/卷，不清空业务库。完整历史数据库/HTTP 套件、设备相册、真实对象存储和模型、生产故障恢复不在本轮范围。

本仓忽略日志为 `composer-install.log`、`composer-check.log`、`composer-database.log`、`composer-server.log`、`composer-storage.log`、`composer-database-post.log`；`storage/` 不随仓发布。

本轮 API PID39884、存储 PID40676、两个专用容器及数据库卷已按进程/容器身份核对后清理，62930–62933 无监听，原五个无关容器保留。
