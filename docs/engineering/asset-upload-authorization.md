# 图片上传分阶段事务授权

维护：Backend。日期：2026-11-04。范围：现有 API-ASSET-01 上传流程；不新增路由、DTO/VO、权限、数据库字段、依赖或迁移。OpenAPI 仍为 1.51.1 / 143 操作。

## 问题与处理

上传入口 Guard 已验证账号与 `asset:upload`，但扫描与 S3 写入发生在之后。原仓储只创建 pending_scan，再直接将 pending_scan 更新为 ready；账号停用、角色停用、成员解绑、grant 删除或权限目录停用可能在外部 I/O 期间发生，旧 Guard 结果不能代表 ready 提交时的授权。

现在 `PrismaAssetRepository.createPending` 在 Serializable 事务内使用实际 `ResolveAuthorizationPrincipal`、`PrismaAuthorizationPrincipalReader` 和 `hasPermission` 重建所有者授权，再建档。`setStatus(..., 'ready')` 用新事务锁定 Asset，读取数据库中的 OwnerUserId 和 pending_scan 状态，再核对当前账号、角色、权限与合法范围元数据后更新。普通用户、商家、自定义多角色均按显式 grant 处理；不要求管理入口，不按 merchant/user 角色键推断权限。

扫描器和对象存储操作不放进长数据库事务。若扫描或 PUT 结束后 ready 事务发现权限已失效，Application 继续沿用失败清理：尝试 pending_scan→rejected，尝试删除对应对象，不签发 URL、不返回 ready；清理后向调用方保留 ForbiddenException（403），不包装成供应商不可用（503），也不自动重试上传。建档事务拒绝时尚无记录，不扫描或 PUT。

rejected 清理不要求已经被撤销的上传权限，否则会阻断收尾；它只允许 pending_scan→rejected，不能修改既有 ready/deleted 资产。管理员在扫描期间停用记录时，ready 的条件更新仍不能复活它。原有本人/管理删除、引用保护、公开投影、签名有效期保持。

## 验证与复现

单测覆盖可配置多角色、停用/解绑/撤销/非法授权主体、建档拒绝无外部副作用、ready 拒绝后的单次补偿以及清理失败不掩盖 403。执行：

```powershell
pnpm exec vitest run src/modules/assets/application/manage-assets.spec.ts src/modules/assets/infrastructure/owned-asset-authorization.spec.ts
```

真实专项沿用 [Windows 独立存储入口](native-storage-validation.md) `pnpm test:native-storage`。该入口创建全新 PostgreSQL/pgvector、MinIO 和 clamd，应用 24 项迁移与两次 seed，先运行既有 `test/assets.db-spec.ts` 再执行真实存储专项。新增七项测试：入口 Guard 通过后、pending 建档前解绑；真实扫描完成后停用账号/权限目录；真实 PUT 完成后停用角色、解绑成员或删除 grant；无商家/管理入口的自定义多角色正常上传。

时序观察器保留并调用实际扫描器与 AWS SDK，在真实操作完成后提交授权变化；不替换 Repository、Storage、Scanner、Guard 或认证 provider。负向场景检查 403 无签名、rejected 记录、真实 S3 HEAD 404、PUT/DELETE 各一次；建档前撤权检查无记录、无扫描/PUT。正向场景用签名下载并核对精确图片字节。最终清理核对基线权限/角色/成员/资产/会话/审计/Outbox、空桶及自建服务与四端口关闭。

旧 scanner-integration 夹具先为合成账号绑定已有 registered_user 系统身份，满足上传原本就要求的显式 grant；不为无权限账号绕过新校验。此旧套件需要其原本的 EICAR 签名环境，未执行时不算入真实存储专项。

## 边界

事务授权以各自 Serializable 快照为准，能拒绝在 ready 事务建立快照前已提交的撤权；不宣称事务提交后已经签发的 15 分钟 URL 可即时撤销，也不宣称消除所有并发串行化冲突。冲突/外部失败沿用既有失败路径，不自动重试。已签发能力 URL、请求开始后的会话注销规则与客户端响应隔离协议保持。

补偿是尽力而为：数据库或 S3 再次故障可能留下 pending_scan、rejected 或未登记引用的对象，403 不证明物理删除成功。此次成功补偿由真实服务专项核对；生产失败清理/孤儿处置另行运维，不自动放行或扩展删除权限。扫描仍仅使用无害测试定义，不证明完整生产病毒库。实际浏览器、设备、生产 TLS/容量与联合灾备仍待验。最终结果与源码绑定见[本轮验收](../validation/asset-upload-authorization-20261104.json)。

## 本轮结果

真实Windows PostgreSQL17/pgvector、MinIO和clamd专项24项（新增7项）通过，资产数据库回归28项通过。建档前解绑无记录/扫描/PUT；真实扫描后停用账号/权限目录，以及真实PUT后停用角色/解绑/删除grant，均403、rejected且S3HEAD404，单次PUT/DELETE。多角色正常上传签名下载精确一致。24迁移/双seed、前后结构/权限基线、清理空桶与四端口关闭通过。

三仓新D盘副本独立冻结安装/check通过：Backend1435单测/20源码工具/177HTTP框架及构建/编译OpenAPI；Web3045业务/20源码/20发布工具、双无缓存构建与standalone；App1217业务/20源码/10产物工具、Doctor20/20、三平台导出与88文件迁移核对。前端产品代码、依赖和24迁移保持，三仓契约仍1.51.1/143操作。

真实方法上的时序观察器不伪造扫描或存储结果；上述事务建立前撤权有实际数据库提交与物理对象核对。未重跑全量业务数据库、Kafka、收费模型或旧EICAR套件，历史证据保持独立。三仓冻结副本、日志和产物均绑定到[本轮报告](../validation/asset-upload-authorization-20261104.json)。
