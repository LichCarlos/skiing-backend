# Windows 独立私有存储验收

2026-11-04 管理端资产读取授权：真实专项现为51项，资产数据库29项，另完整数据库859项通过。管理列表/详情签名期间的撤权/目标变化均有实际HTTP与物理对象核对，见[读取授权](admin-asset-read-authorization.md)。下方数字保留其历史范围。

2026-11-04 本人资产读删授权：真实专项现为34项，另运行29项资产数据库测试；新覆盖签名前后撤权、删除提交授权和行锁等待后的引用保护。见[本人资产读删说明](owned-asset-access.md)。下方计数为各自历史阶段结果。

2026-11-04 上传事务授权续修：真实专项现为24项，另在同一隔离环境运行28项资产数据库回归。新增pending/ready事务授权与在途撤权补偿，当前实现、证据和限制见[上传事务授权](asset-upload-authorization.md)；下方17项及更早计数保留为当时历史结果。

2026-11-04 管理端续验：现行专项在原十项上新增七项管理端真实存储场景，总数十七项；角色/权限/范围基线恢复及审计故障注入清理也纳入入口，见[管理端验收说明](admin-assets-real-storage.md)。下文十项与 SDK 对齐记录保留其当轮范围。

维护：Backend。日期：2026-11-04。入口 `pnpm test:native-storage` 使用已准备的 PostgreSQL 17/pgvector、固定提交 MinIO 和 ClamAV 1.4.x Windows 可执行程序，不安装系统服务，不访问 Docker 或其 WSL 发行版。产品代码保持 TypeScript；Go 只用于编译第三方 MinIO。

## 环境与执行

先验证第三方下载来源、归档摘要与版本。MinIO 固定提交、源归档校验及构建参数沿用[源码构建说明](minio-source-storage.md)。ClamAV 本轮选择与既有专项一致的官方 1.4.3 Windows x64 包，SHA-256 为 `5c86a6ed17e45e5c14c9c7c7b58cfaabcdee55a195991439bb6b6c6618827e6c`，来源为 [Cisco-Talos 官方 release](https://github.com/Cisco-Talos/clamav/releases/tag/clamav-1.4.3)。这是隔离测试版本，不替代生产补丁与病毒库维护。

在本仓独立运行：

```powershell
$env:LINJI_NATIVE_PG_ROOT='D:/runtime/pgsql'
$env:LINJI_NATIVE_MINIO='D:/runtime/minio.exe'
$env:LINJI_NATIVE_CLAMD='D:/runtime/clamav/clamd.exe'
$env:LINJI_NATIVE_STORAGE_OUTPUT='D:/validation/storage'
$env:NODE_OPTIONS='--max-old-space-size=1536'
$env:VITEST_MAX_WORKERS='1'
pnpm install --frozen-lockfile
pnpm db:generate
pnpm test:native-storage
```

路径为示例，须替换为已核验的本地运行时。脚本要求 Windows、PostgreSQL 17、MinIO 指定 commit 和 ClamAV 1.4.x；记录实际二进制摘要和版本。每次创建新的输出子目录，不接受现有数据库、数据目录或服务地址。四个端口只绑定回环；数据库名、桶名固定为既有专项的安全门禁值，凭证全部随机生成并只用于本次子进程。

脚本创建空 PostgreSQL 集群、执行全部 migration、双 seed、前置结构核对和两次私有桶初始化，再执行现有 `test/assets.storage-integration-spec.ts` 十项测试。真实 Nest 路由、鉴权、Prisma、AWS SDK、MinIO、clamd 均不替换。覆盖上传后 ready、900 秒签名下载、匿名/篡改/过期拒绝、他人 404、内外 host 签名、头像引用保护、初始化不改数据、错误凭证失败、扫描拒绝无对象及物理删除后旧链接失效。

## 测试定义与清理边界

扫描器仅加载仓库中的无害测试标记定义 `test/fixtures/linji-test-only.ndb`，以实际扫描引擎验证 INSTREAM、命中、拒绝和状态链路。未加载官方完整生产病毒库，关闭本专项不需要的文档/归档格式解析，不据此声称恶意文件覆盖、生产扫描性能或实时病毒库更新已验收。独立 EICAR 专项不计入本轮十项。

用例结束后再核对数据库结构、仅剩初始化账号、无资产/会话/操作日志/Outbox 测试残留及桶内无对象。脚本在 finally 中关闭自己持有的 MinIO/ClamAV 进程、停止本次集群，并探测四个端口关闭；不按名称杀其他服务，不递归删除目录。临时密码文件移除，日志脱敏，数据库与存储目录保留诊断。`completed` 表示测试流程完成，仍须同时检查停止、端口和命令退出状态。

本入口验证真实服务在 Windows 单机上的功能互通，不证明生产 S3、TLS、容器、灾备、浏览器/设备或第三方模型；不改变 OpenAPI、数据库 migration 或业务规则。实际执行与证据见下节。

## 本轮执行结果

新增独立pnpm test:native-storage入口，使用固定源码MinIO、官方ClamAV1.4.3及全新PostgreSQL17/pgvector，不启动/重启Docker或借用其WSL。现有十项真实存储用例在原仓及新独立源码副本均通过（不累计成二十项），24迁移/双seed/前后核对完成；最终仅初始化账号，资产/会话/操作日志/Outbox为零、桶无对象，本次PG/MinIO/ClamAV均停止、四端口关闭。扫描仅仓库无害标记定义，未装载官方完整病毒库，不证明恶意样本/生产签名更新。首轮clamd临时目录正斜杠不被接受，改为Windows原生路径后新目录复验；首次模型名类型错误及下载工具失败均保留。

三仓在各自D盘新源码副本冻结安装与check通过，复用各仓既有独立store且不跨仓借用代码/依赖，不宣称全新store下载。Backend1271单测+20源码工具、173HTTP/框架、build及编译后契约；Web3045业务+20源码工具+20发布工具、官网/Admin双强制无缓存构建与standalone核对；App1217业务+20源码工具+10产物工具、Doctor20/20、三平台导出/导出后类型及88文件封存迁移核对通过。

OpenAPI1.51.1/143操作及24迁移不变，无业务API/数据库变更；App首次Doctor19/20报告六个包不匹配，已按官方SDK58文档用ExpoCLI更新六个直接依赖及锁文件，镜像未同步新包导致一次404后改用官方源在同一副本/store续装通过，重新冻结安装/完整检查与导出通过，未排除Doctor检查或跨SDK主版本；本轮未重跑845项全库数据库或Kafka。当前WindowsKafka删除故障及35秒场景、真实浏览器/设备、生产存储/TLS/完整病毒库、模型供应商、容器和远程CI仍待验。D-49/D-50/D-09未改，父目录依赖清理和先前服务启动拒绝未重试，无提交/推送/发布，整体目标未完成。

[本仓验证报告](../validation/native-storage-20261104.json)记录源码摘要、二进制与官方归档摘要、失败与成功运行、独立安装/check/build日志。源码副本冻结在最终结果文档前，产品代码/依赖/契约与原仓逐文件核对；最终结果README/报告随后归档，不回写此前的源码交付包。第三方下载、Go模块缓存及构建产物仅存D盘，不纳入产品仓库。
