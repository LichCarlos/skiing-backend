# 图片资产、真实数据库与扫描器验收

2026-11-02当前续验：[官方固定源码MinIO构建与真实私有存储](minio-source-storage.md)已实施，原Compose失效镜像/mc依赖已替换。真实MinIO/ClamAV/PG/Nest专项十项、原扫描五项和前后数据库校验通过；匿名/篡改/过期拒绝、不同公网host签名、引用保护、初始化幂等与物理删除已验。下文MinIO未获取、内存存储等记录保留早期阶段范围；实际浏览器/设备、生产S3与恢复仍待验。

日期：2026-10-29。API-ASSET-01/02 的路由和 DTO/VO 不变，新增验证分开记录数据库、扫描器及对象存储的真实程度。后续 D-41 已确认并实施 all/self/selected 同范围过滤，见 [资产范围说明](global-asset-scope.md)；下文 9 项及 ClamAV 结果为此前扫描阶段证据。

## 生产修复

ClamAV 适配器现在对提前 end/close 立即返回 503；原实现只有超时/error 处理，在连接没有完整响应就关闭时可能留下未结束 Promise。响应以 NUL 结束，精确接受 stream: OK 或 stream: <signature> FOUND；其他格式、超过 8192 字节的响应拒绝。timeout 必须是有效的正整数，避免非法配置被 Node 转成意外的超时时间。

资产 ID 统一校验 canonical 正十进制与 PostgreSQL signed BigInt 上限 9223372036854775807。管理列表的 ownerUserId 限 PostgreSQL Int，offset 限安全整数和数据库 Int 范围。越界在应用层返回 400，不进入 Prisma 并变成 500。

## 自动化覆盖

| 层级                   | 测试及范围                                                                                                                                     | 外部替身                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 快速回归               | 8 项新扫描器用例：提前断开、不完整响应、非法/过长响应、TCP 分片和超时；5 项管理参数溢出用例；原域测试补 BigInt 上限断言                        | 扫描协议使用真实本地 TCP server，服务端为协议替身 |
| HTTP/PostgreSQL        | test/assets.db-spec.ts，9 项：真实登录/JWT/Guard、multipart/大小/格式、Owner 隔离、rejected 状态、引用保护、全局列表/范围、审计/回滚、越界响应 | 仅 Storage/Scanner 端口替身                       |
| 实际 ClamAV/PostgreSQL | test/assets.scanner-integration-spec.ts，5 项：干净 PNG、标准无害 EICAR 测试模式、并发隔离、扫描通过后 ready/删除、真实端口不可用时拒绝        | 对象存储仍为内存替身                              |

HTTP 测试使用 IdentityAccessModule、AssetsModule 和生产 PrismaAssetRepository。审计失败回归在专用数据库安装仅命中本例目标的临时触发器，检查 OperationLog INSERT 失败后 Asset 仍 ready、没有成功审计、对象删除未调用；finally 移除触发器/函数。删除引用保护使用真实 SkiResort.CoverAssetId 外键，不用预设引用计数替身。

先前新增 TCP 分片测试因本地 server 默认关闭半连接而失败，测试 server 改为 allowHalfOpen=true 后，完整扫描器与资产快速套件通过；生产客户端没有为通过测试而接受不完整响应。真实 ClamAV 五项也通过。

## 实际环境与未通过项

专用 PostgreSQL/pgvector 容器 linji-assets-validation-db-20261029，完整 ID f32b5a73e69cfc8705e4d5304072e969373d41a63dd89376e0b190f5f3062975，loopback 随机端口 53547，数据库 linji_validation。专用扫描器 linji-assets-validation-scanner-20261029，完整 ID 501ce4a6a9a9bea4c5bb99d8ab51bd257dc130fc01571461a7f1f7c0bba002c7，loopback 随机端口 55156。两者均带 linji.validation=assets-20261029 和 AutoRemove=true，不使用其他项目容器或用户数据。

扫描器镜像 clamav/clamav:1.4.3，digest sha256:75fb5fd95fcbe1d7e6d240c369c1572b686ee2c95949d1042b5148de8eddebb4。clamdscan --ping=1 返回 PONG。测试环境使用镜像自带定义并设置 CLAMAV_NO_FRESHCLAMD=true；日志提示病毒库超过 7 天。这些证据证明协议及指定测试模式识别，不能证明最新病毒防护能力。生产 Compose 未关闭签名更新。

MinIO 未能拉取：配置中的 minio/minio:RELEASE.2025-09-07T16-13-09Z 与另一个已有发布版本在 Docker Hub 均被拒绝；quay.io 官方来源返回 unauthorized；已有本地配置的镜像站也拒绝；MinIO 官方归档下载返回 410 Gone。没有替换为不明镜像或把内存存储冒充 MinIO，原 Compose 镜像未更换。S3 签名 URL 的真实下载、私有访问、对象上传/删除、跨端预览和 MinIO 冷启动仍待验收。

新增测试不会证明全部并发撤权、引用竞争、物理删除失败后的重试回收或业务上传中断后的孤立对象清理；现有数据库软删除与外部对象删除并非一个分布式原子事务。

## 独立执行

数据库测试按本仓 README 配置专用 DATABASE_URL，执行 db:deploy、两次 db:seed、db:verify、pnpm test:db。不要对共享开发/生产库执行带临时触发器和清理逻辑的测试。

真实扫描套件单独使用 vitest.config.assets-integration.ts，不要求 Kafka。配置专用数据库和扫描器，然后运行：

```powershell
$env:DATABASE_URL = '<dedicated migrated test database URL>'
$env:ASSET_INTEGRATION_CLAMAV_HOST = '127.0.0.1'
$env:ASSET_INTEGRATION_CLAMAV_PORT = '<dedicated scanner port>'
pnpm test:assets-integration
pnpm db:verify
```

普通 pnpm check 不自动连接外部服务。原 test:integration 保持 Kafka 套件专用；GitHub Actions 新增独立 asset-scanner-integration job，提供 PostgreSQL/ClamAV、迁移/seed/结构校验并执行五项真实扫描测试。数据库 9 项自动纳入已有 test:db job。远程 CI 尚未执行，本地通过不等于远程通过。

最终结果：Backend check 109 文件/624 项、HTTP 79 项、build/OpenAPI 通过；完整 test:db 11 文件/75 项通过（含资产9项），实际扫描5项通过，测试后 db:verify 通过。三仓冻结安装通过，Web check102项与双应用build通过；App初轮Doctor远端元数据异常19/20，复验完整check64项/20-20和三平台export通过。无新增migration/依赖/HTTP schema；OpenAPI1.29.0三仓哈希和Web/App生成类型校验一致。

两专用容器已核对完整ID、名称、标签和AutoRemove后停止，确认自动移除，其他项目4个容器继续运行。没有修改用户.env、启停既有官网/Admin、提交或推送代码。复验请重建隔离容器，不复用本次已移除端口。
