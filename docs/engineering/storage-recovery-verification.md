# 恢复后数据库与 S3 图片只读核验

数据库恢复不能恢复 S3 对象。`pnpm storage:verify-recovery` 用于在隔离恢复环境中核对 Asset 与真实对象；不执行上传、复制、删除、状态修复、数据库迁移或业务写入。它不依赖 Web/App，也不改变 OpenAPI、权限或数据库结构。

## 执行

先冻结所有业务写入，包括 API、后台任务、Kafka 消费者、扫描器、存储生命周期任务和其他 S3 写入者。用独立只读数据库账号（public schema 的 USAGE、各表 SELECT）和仅有目标桶 GetObject 权限的 S3 凭证。生产端点使用 HTTPS；仅 loopback 允许 HTTP。输出父目录必须已存在并位于本仓库外，服务账号独占写权限；Windows 需要目录 ACL，POSIX mode 不能替代 ACL。

通过进程环境注入 `DATABASE_URL`、`S3_ENDPOINT`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`；可选 `S3_REGION`（默认 us-east-1）与 `S3_REQUEST_TIMEOUT_MS`（默认 30000，范围 1–120000）。脚本不加载 `.env`，不使用隐式 AWS 凭证链，不跟随 `S3_PUBLIC_ENDPOINT`。在本仓执行：

```powershell
pnpm storage:verify-recovery --confirm-database linji_recovered_20261104 --confirm-bucket linji-restored-assets --writes-paused yes --report D:/secure-recovery/asset-check-001.json
```

数据库名、桶名和暂停写入声明必须显式匹配；声明不能证明外部写入已停止。报告必须使用新文件，既有文件或符号链接不能覆盖。退出码 0 且报告 `completed=true,passed=true` 才算此次核验通过；退出 1 表示差异、配置错误、访问失败或中断。进程被杀会保留未完成报告；失败后用新路径重试，不自动重试 S3 请求。报告仅含资产 ID、分类、计数与指纹，不包含对象键、文件名、地址、业务正文、密码或供应商原始错误。详细问题最多 100 条，完整数量保留在 `issueCount/issueCounts`。

## 核验范围

- 使用 PostgreSQL RepeatableRead 只读事务、200 行 keyset 分页扫描全部 Asset，包含当前未被引用的 ready 图片。每个 ready 对象使用 GetObject 流式计算 SHA-256，核对实际大小、Content-Length、Content-Type 与图片头签名；不以 ETag 代替 SHA-256。
- ready 元数据必须符合现有 JPEG/PNG/WebP、1 字节–10 MiB、64 位 SHA-256 规则。对象读取超出 10 MiB 即停止；单对象时限覆盖响应头和完整响应体。请求不重试，总核验限制 30 分钟，单条数据库语句时限 30 秒。大型环境应安排维护窗口并另行评估容量，不能把超时视为通过。
- 检查头像、雪场封面、雪场相册、文章封面、动态图片五类引用。隐藏、草稿及软删除业务记录仍有外键引用，不能忽略；任何指向缺失或非 ready Asset 的引用均失败。
- pending_scan/rejected/deleted 资产不要求物理对象存在，但其业务引用仍检查。未知状态失败；不扫描桶内未登记对象，不清理孤儿、不核对收益 CSV、旧 URL 图片、S3 历史版本、桶策略或病毒库。不重新执行病毒扫描；图片头检查不等于完整解码验证。
- 首轮快照内核对对象，随后用第二个只读事务重算全部 Asset 核验元数据与五类引用的指纹。相同行数下的换绑/状态变化也会发现；快照间变化导致失败。指纹不输出内部内容。

数据库与 S3 没有原子快照。双读不能检测在两次扫描间发生又撤销的更改，或对象在读取后被修改；暂停写入仍是必要前提。全为非 ready 或空库时，ready 计数为零，不能据此推断 S3 可用。成功只表示本次读取的当前对象与数据库元数据匹配，不证明备份来源、历史版本恢复点、生产容量、RPO/RTO 或完整联合灾备通过。

## 隔离复现

先完成本仓冻结安装、`pnpm db:generate`，准备 Windows PostgreSQL 17（含匹配 pgvector）及 MinIO 原生二进制。以下路径替换为本机路径，输出父目录先创建：

```powershell
$env:LINJI_STORAGE_RECOVERY_CONFIRM='synthetic-new-services-only'
$env:LINJI_NATIVE_PG_ROOT='D:/postgresql/17'
$env:LINJI_NATIVE_MINIO='D:/tools/minio.exe'
$env:LINJI_STORAGE_RECOVERY_OUTPUT='D:/isolated-recovery-runs'
pnpm test:storage-recovery
```

该命令创建全新 loopback PostgreSQL/MinIO、随机凭证/端口及专用库/桶，应用 24 项 migration、两次 seed。夹具直接写入合成数据，并用真实 SELECT-only 账号执行核验 CLI；涵盖五类引用、超过 200 行分页、未引用 ready 对象、缺失、同大小损坏、大小/MIME 错误、非 ready 引用、S3 鉴权失败、拒绝覆盖、目标不符及修复复验。每次调用前后比较全部 public 表数据与对象列表指纹，结束核实自建进程停止、端口关闭，保留脱敏报告/合成数据；不接触现有服务，不需要 Docker、ClamAV 或付费模型。复现 runner 当前限定 Windows，不能推断其他平台已验。

合成测试刻意跳过上传和扫描业务链，只验证恢复核验；真实上传/扫描已有[独立存储验收](native-storage-validation.md)。本轮真实Windows专项与三仓工程检查通过：Backend1418单测/20源码工具/177HTTP，Web3045业务/20源码/20发布工具及双构建，App1217业务/20源码/10产物工具与Doctor20/20及三平台导出。9次CLI预期退出码与数据只读核对通过，另验证只读账号拒绝UPDATE，自建服务停止及三端口关闭；细节见[恢复核验证据](../validation/storage-recovery-20261104.json)。数据库加密恢复步骤见[数据库备份与恢复](database-backup-restore.md)。
