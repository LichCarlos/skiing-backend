# 资产管理数据范围

2026-10-29：D-41 已获用户确认并实施，替代此前仅允许 all 的临时边界。HTTP 路由与 DTO/VO 保持，OpenAPI 1.30.0 已描述新的范围行为。

| 范围                   | 服务端过滤                           |
| ---------------------- | ------------------------------------ |
| all                    | 全部资产                             |
| self                   | OwnerUserId = 当前认证账号           |
| selected               | AssetId 属于指定 ID 集合，可跨 owner |
| merchant               | 403，资产没有商家归属                |
| 缺失、无效或多角色冲突 | 403，拒绝执行                        |

管理入口与动作权限独立校验；不通过角色名称推断权限。列表查询的 ownerUserId/status/keyword 只缩小范围；列表与 count 使用相同 where。详情和删除找不到范围内目标均返回 404，不返回读取 URL、修改对象或写成功删除日志。普通 owner API-ASSET-01 继续按本人归属。

## 实现

domain/admin-asset-access.ts 校验服务端范围和 self 的认证账号，拒绝空 selected、非法/不安全 ID、merchant。应用和仓储端口都要求显式 AdminAssetAccess，不提供默认 all。Prisma 查询通过共同的 assetAccessWhere 生成范围条件，与调用方筛选用 AND 相交。

删除预检、事务 updateMany 及失败后的可见性查询都带同一范围。更新失败后范围内目标不存在返回 not_found，应用映射 404；有引用或当前不可删返回 422。软删除和 OperationLog 同事务成功后才移除存储对象。真实数据库用例在预检之后改变 owner，验证事务拒绝并保留对象。

selectedIds 沿用既有角色授权 number[] 正安全整数规则，不能为超出 Number.MAX_SAFE_INTEGER 的资产分配 selected 授权；不得截断或舍入。列表/详情的 AssetId 继续按 PostgreSQL signed BigInt 十进制字符串传输，all/self 支持完整 ID 范围。未来若扩展字符串 selectedIds，须统一调整角色授权契约与三端。

## 验证与边界

真实数据库套件 11 文件/78 项通过，其中资产 HTTP/PostgreSQL 12 项，扫描和存储为替身。覆盖 all、self、selected 跨 owner、筛选/分页/count、范围外 404、冲突/merchant 拒绝、预检后归属变化、引用保护及审计失败回滚。快速套件 109 文件/628 项及 HTTP 3 文件/79 项通过。首轮 3 项因测试夹具误用 RoleDataScopes 关系名失败；修正为 schema 的 DataScopes 后完整数据库套件通过。

范围来自每请求 Guard；本阶段没有在资产事务内重新加载完整角色授权，不保证撤权立即终止所有在途请求。未重跑真实 Kafka/ClamAV；历史证据见 [资产验收](asset-validation.md)与 [Kafka 验收](kafka-rag-integration.md)。真实 MinIO/S3、浏览器/设备、存储失败回收与全域授权并发仍缺；整体项目未完成。

本轮专用库容器 linji-asset-scope-validation-20261029，完整 ID ab7109648de90f714b39154150a4de899731a7eb507d4977dc65d430b6978d57，镜像 pgvector/pgvector:pg17，loopback 随机端口 51802；19 个迁移、两次 seed 和测试前后 db:verify 通过。复验必须重建独立空库，不能复用历史端口或对开发/生产库执行。

验收后已再次核对完整 ID、名称、任务标签和 AutoRemove=true，仅停止本轮专用容器，确认自动移除。其他项目容器与用户既有服务保持运行。
