# PostgreSQL 加密备份与新库恢复

适用：Node.js 22、PostgreSQL 17 客户端与服务端、兼容的 pgvector 扩展。入口为本仓 `scripts/database-backup.ts`；不依赖 Web、App 或父目录。备份包含本数据库的结构、数据、迁移历史、向量和序列，不包含集群角色、原有所有者或 ACL。

## 配置与备份

由运维进程注入 `DATABASE_URL` 和 `BACKUP_ENCRYPTION_KEY`。后者必须是独立随机生成的 32 字节密钥，以 64 位十六进制表示；保存在秘密管理器中并记录密钥版本，不写入命令、日志、仓库或备份目录。脚本不自动读取 `.env`。远程 PostgreSQL 使用 `sslmode=verify-full` 和可信 `sslrootcert`；省略 SSL 参数时遵循 libpq 默认行为，不能据此宣称远程传输已校验。

以下命令在 Backend 仓库执行，示例路径需要按运行环境替换。备份父目录须已存在，输出目录必须为仓库外的全新绝对路径；服务账号独占目录写权限。Windows 需要配置目录 ACL，POSIX mode 不能替代 Windows ACL。

```powershell
pnpm db:backup --directory D:/secure-backups/linji-20261104-001 --pg-bin D:/postgresql/17/bin
```

脚本将 `pg_dump --format=custom --no-owner --no-acl --serializable-deferrable` 的输出直接送入 AES-256-GCM 加密流，不生成明文 dump 文件。每次使用随机 96 位 IV、128 位认证标签和固定格式 AAD。目录包含 `database.dump.aes256gcm` 与 `manifest.json`；清单记录来源主机/端口/数据库名、时间、工具版本、密文大小/SHA-256、IV 和标签，不记录账号、密码或密钥。清单本身未加密，应同样限制访问。

成功输出中的 `manifestSha256` 应通过独立可信渠道归档，绑定备份时间、密钥版本和变更单。不能在恢复时直接对收到的清单重新计算摘要并视其为可信；密文与清单一起被替换时，这种方式不能验证来源。完整包与密钥应分别保存，按真实数据保留策略配置异地副本、不可变存储和定期恢复演练。复制完成后再核对摘要。

失败会保留不完整目录供检查。缺失有效清单的目录不算成功备份；使用新路径重试，不覆盖旧目录。一次逻辑快照不包含之后提交的事务，脚本没有 WAL 归档、PITR 或跨系统一致性承诺。

## 恢复到全新数据库

先停用目标环境的所有业务流量及写入者，包括 API、Outbox polling、Kafka consumer、收益导入和扫描任务。仅设置 `OUTBOX_DISPATCH_ENABLED=false`、`KAFKA_CONSUMER_ENABLED=false` 不会暂停其他写入来源，不能代替隔离环境。目标主机须已安装匹配的 pgvector 二进制；连接账号需要访问 `postgres` 维护库、创建数据库及安装备份内扩展的权限。生产账号、网络/TLS、扩展安装和授权由 DBA 预先配置，不使用应用日常账号执行特权恢复。

向进程注入目标 `DATABASE_URL` 与对应备份密钥。目标 URL 的数据库名必须与 `--confirm-target` 完全一致；不得使用源端点/源库，也不得使用 `postgres`、`template0`、`template1`。

```powershell
pnpm db:restore-new --directory D:/secure-backups/linji-20261104-001 --pg-bin D:/postgresql/17/bin --manifest-sha256 <独立归档的64位摘要> --confirm-target linji_recovered_20261104
```

脚本先检查可信清单摘要、格式、密文摘要与大小，再完整解密至丢弃流以验证 GCM 标签，之后才调用 `createdb --template=template0`。已有数据库会失败，不执行 DROP、CLEAN 或覆盖。目标新库创建后，以 `pg_restore --single-transaction --exit-on-error --no-owner --no-acl` 从解密流恢复；恢复失败会回滚该次恢复事务并保留新库供检查，不自动删库或重试。工具诊断可能包含业务数据，因此 CLI 仅输出通用失败信息；维护者在受控环境核对工具版本、文件权限、数据库服务日志及新库状态，禁止将完整原始日志公开。

只恢复经过来源验证、访问控制和审核的自有归档：数据库归档可能包含可执行 SQL。脚本的摘要及 GCM 校验验证包来源/完整性，不能判断 SQL 的业务安全性。恢复期间禁止其他进程修改备份包。

## 恢复后的放行步骤

1. 保持 API、外部流量和所有任务停止。在隔离目标执行 `pnpm db:verify`，核对 24 项迁移、结构/约束/索引与 pgvector 版本，并运行 `pnpm db:deploy` 确认无待执行迁移。此脚本不会自动迁移、seed 或修改业务记录；不要在未审查时重新 seed 来掩盖恢复差异。
2. 对照备份时的可信业务核对清单比较表行数/摘要、金额精度、外键、序列、RBAC/字典/字段策略、软删除及 RAG 来源状态。恢复时所有者为恢复账号；DBA 重新配置应用最小权限后才允许业务进程连接。
3. 历史快照可能恢复已经注销的登录会话。放行业务前，在恢复库通过受审变更事务执行 `UPDATE "AuthSession" SET "RevokedAt" = CURRENT_TIMESTAMP WHERE "RevokedAt" IS NULL`，记录执行人/原因/数量并复核；登录缓存与客户端缓存失效，用户重新登录。密钥轮换与密码/权限在备份后发生的变化也要单独核对。该安全处理会有意改变恢复后的指纹，应在原始恢复校验之后执行。
4. 对象存储图片/CSV 与数据库记录必须来自可核对的恢复点，检查对象版本、大小、摘要和 Asset 关联。图片使用新增 `pnpm storage:verify-recovery` 只读核验，配置与限制见[恢复后资产核验](storage-recovery-verification.md)；必须退出 0 且报告 completed/passed 均为 true，CSV/旧 URL/版本历史另行核对；私有签名 URL 由服务重新生成。数据库 dump 不备份 MinIO/S3 文件、病毒库、供应商密钥或配置。
5. Kafka 的 topic、offset、集群元数据不在本包内。数据库回退可能使 Kafka offset 超前，跳过已恢复为 pending 的历史业务，或重放已执行的外部副作用。先保存集群状态、核对 Outbox/EventId/Inbox 和导入任务，制定逐项重放与对账方案，再经审查恢复消费者；不要批量清空 Inbox、重置 EventId 或直接改写完成状态。现有租约/fencing 与幂等不能自动解决跨恢复点的一致性。
6. 核对处理中 AI/索引/事件任务的时间与租约，沿用既有恢复/重试路径，禁止启动两个恢复环境争用同一外部资源。RAG 必须保持相同 Embedding 模型修订、维度和归一化方式，检验来源可见性、当前有效版本和撤回过滤；需要重建时使用已有运维接口。恢复向量不代表索引与当前来源一致，也不自动调用收费模型。
7. 在隔离环境完成认证、授权、商家隔离、收益查询、资产读取及 AI 引用冒烟后才申请正式切流。记录实际数据量、耗时、缺失事务及外部对账结果，评估真实 RPO/RTO；脚本没有自动切流功能。

## 本地验收范围

### 独立仓库复现入口

本仓新增 `pnpm test:database-recovery`，不依赖父目录、既有数据库或历史 D 盘脚本。先独立执行冻结安装和 `pnpm db:generate`，准备 PostgreSQL 17（安装兼容 pgvector）的原生 `bin` 目录，以及仓库外已存在且仅当前运行账号可写的输出父目录。Node.js 版本遵循本仓 `.nvmrc`。

```powershell
$env:LINJI_DATABASE_RECOVERY_CONFIRM='synthetic-new-clusters-only'
$env:LINJI_DATABASE_RECOVERY_PG_BIN='D:/postgresql/17/bin'
$env:LINJI_DATABASE_RECOVERY_OUTPUT='D:/isolated-recovery-runs'
pnpm test:database-recovery
```

该命令会创建专用新目录与两个随机端口的 loopback 集群，不读取现有 `DATABASE_URL`；继承的 libpq 配置、Prisma 引擎覆盖、初始账号及备份密钥会清除，测试凭证和密钥重新随机生成。全部数据为合成数据，输出目录保留结构指纹、原始 CHECK 定义及脱敏结果；结束时验证本次集群停止、端口关闭并删除密码临时文件。失败时不删除数据目录，也不会停止系统数据库服务。日志/数据目录可能包含合成账号密码哈希，应限制访问；本轮密钥不保留，密文仅作为演练证据。

`initdb` 直接接收参数，无 shell 拼接；路径要求绝对路径，禁止引号与控制字符，输出真实路径必须位于仓库外。Windows 须按前述规则设置目录 ACL。POSIX 原生工具命名已适配，但平台验证范围以各轮记录为准，不能将 Windows 通过直接视为 Linux/macOS 通过。本机演练不使用 Docker，也不调用模型或 Kafka。

独立入口已在新源码副本 Windows PostgreSQL 17.11 / pgvector 0.8.1 通过（运行 `linji-recovery-E5UFlB`）。没有复制外部 runner，实际执行包脚本；故意传入不可连接的外部数据库 URL、无效 libpq 配置和不存在的 Prisma 引擎后仍成功。1357 单测、20 源码工具、173 HTTP 框架与构建通过；三仓工程结果及 24 项原生命令见[本轮证据](../validation/database-recovery-repro-20261104.json)。首轮暴露 Prisma 模块加载期捕获引擎配置；修复为清理本 CLI 环境后动态加载，失败日志与修复诊断保留，最终新副本复验通过。Linux/macOS 尚未实测；下方历史外部专用脚本结果保持独立计数。

两独立 PostgreSQL 17/pgvector 集群的合成数据演练已通过独立源码副本复验（运行 `run-20261104051020828`）。39 张表行指纹、114 个索引、182 个约束、19 个序列及扩展核对一致。源集群先停止，再从密文包恢复到第二集群；错误摘要、错误密钥、篡改密文、已存在备份目录/目标库均拒绝。恢复后检查所有表行指纹、索引、约束、序列、1024 维向量距离、金额、会话引用、Outbox/Inbox；外键继续生效、序列继续增长，缺少扩展安装权限时恢复事务回滚且保留空新库。

PostgreSQL 在 dump/restore 时可能重写 CHECK 中数组类型转换的表达式。演练保留原始定义，并将两侧 CHECK 交给 PostgreSQL 重新解析后比较规范结果；不删除约束或跳过差异。向量仅为合成固定向量，本轮不调用真实模型、Kafka 或浏览器。演练密钥只存内存且运行后不保留，因此演练密文归档仅作合成验证证据，不能用作后续恢复包；真实备份必须另行保管密钥。

不包含生产全量恢复、对象存储/Kafka 联合恢复、PITR、生产容量/RPO/RTO 或签名发布验收。两临时集群及端口均已停止/关闭，密码文件与 postmaster.pid 已清理；数据目录仅保留合成证据。CLI 配置/清单边界由 `scripts/database-backup.spec.ts` 覆盖；23 项新增边界测试及本仓完整 1346 单测、20 源码工具、173 HTTP 框架与构建通过；三仓独立检查、19 项原生命令（负向场景预期退出 1）和清理结果见[验收摘要](../validation/database-restore-20261104.json)。首轮夹具状态拼写错误及次轮 CHECK 文本比较失败分别保留，修正后诊断与最终独立复验通过，不累计为一个套件。
