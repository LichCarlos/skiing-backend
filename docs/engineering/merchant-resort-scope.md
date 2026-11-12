# 商家雪场范围与写入审计

2026-10-30 更新：四类写命令已增加事务内 RBAC/范围复核、动态字段快照和图片/标签引用锁，新增真实 HTTP 测试 29 项，连同原范围测试共 33 项通过。见 [商家雪场事务授权](merchant-resort-transaction-authorization.md)。下方 2026-10-29 的测试数量与“仍使用 Guard 快照”描述按历史记录阅读；查询路径与在途撤权保证的边界以新文档为准。

> 2026-10-29 后续数据库复验：商家真实 PostgreSQL 4 项已通过，涵盖范围交集与状态/收益审计。 19 个迁移、两次 seed 和结构复验亦通过。下文旧“未跑”描述保留为当时阶段记录，当前验证范围以 [数据库验收](database-validation.md) 为准。

2026-10-29，D-38 已确认。适用于 API-R02 商家雪场和 API-R03 收益查询；沿用 OpenAPI 1.28.0，无新增 HTTP 字段、依赖或 migration。

## 范围规则

所有路由仍要求管理门户及对应动作权限，不按角色键判断商家身份。Controller 只能从 Guard 的 `authorizationDataScopes.resort` 取得范围，并连同认证账号及 MerchantId 传入 Application，客户端不能提交范围或归属。

| 有效范围 | 商家接口的实际含义                                                    | 可创建雪场          |
| -------- | --------------------------------------------------------------------- | ------------------- |
| self     | 当前账号对应的有效 MerchantProfile；scope.userId 必须等于当前账号     | 是，需 create grant |
| merchant | 当前账号对应的有效 MerchantProfile；scope.merchantId 必须等于当前商家 | 是，需 create grant |
| selected | 指定雪场 ID 与当前账号商家归属的交集；空集配置或非法 ID 拒绝          | 否，403             |
| all      | 商家路由仍限定当前账号自己的商家雪场                                  | 是，需 create grant |

缺少范围、主体不匹配或无商家资料返回 403。每次数据库过滤同时包含 MerchantId、MerchantProfile.UserId、商家及账号 active、雪场未删除；即使传入别人的 MerchantId，查询也得不到其数据。合法范围下，未选中、跨商家或不存在的单条目标统一 404。全局 `/admin/resorts` 另按 API-M05，仅接受 all，不能借商家 all 访问其他商家。

列表与 count 共用 WHERE，selected 在分页之前过滤。详情、编辑、软删除和提交审核保留相同交集，目标 ID 使用额外 AND，避免覆盖 selected 的 `ResortId in (...)`。编辑和审核写入带 UpdateTime 乐观条件，删除在事务内读取并检查 UpdateTime；并发变更返回 409。

收益明细、count、金额汇总、按日分组以及指定雪场名称查询共用相同归属与范围约束。明细查询未匹配时为空；指定雪场汇总目标不可见时为 404。金额仍使用 decimal 字符串，商家没有写收益接口。

动态字段目录允许合法 selected 范围，仍核实当前有效商家资料；它只返回字段定义和有效角色 CanRead/CanWrite 并集，不返回未选中雪场的数据。

## 事务与审计

创建、编辑、软删除、提交审核使用 Serializable 事务，事务内再次检查账号 active、MerchantProfile active 及账号归属。创建/编辑在事务内重新核对图片 ready 且本人所有、标签和字典类型 active。业务写入、关系更新、`resort.changed.v1` Outbox 与 OperationLog 同事务提交，审计失败会使整个事务失败。

审计记录服务端操作者、账号快照、动作、目标雪场、traceId、IP、User-Agent，以及必要的名称/归属/状态摘要。编辑记录提交字段名，不记录完整 customFields 或私密正文。P2034 映射为 409，不拿旧的预读内容自动重试。

## 验证及尚未完成的内容

Backend `pnpm check` 88 文件 / 419 项通过，HTTP e2e 2 文件 / 63 项通过。新增测试覆盖缺失/非法范围、self 主体不匹配、all 不扩张归属、selected 分页与 count、记录操作交集、禁止创建、字段目录、收益各查询，以及四类写入审计、事务内资料失效、图片状态变化、审计错误传播和 P2034。

`pnpm openapi:generate`（含 Nest build）通过。Backend/Web/App 的 OpenAPI 1.28.0 SHA-256 均为 `61ede5b5214de4f47c1631b12ce5735384fed0fe1c26ac8d3a4c1f43db7c0c4e`；Web/App 各自 `pnpm openapi:verify` 通过。10 份修改代码的格式检查通过，8 份相关 Markdown 的本地链接无失效项。

HTTP 测试使用业务服务替身，验证真实 Guard 和 Controller 的范围传递；mock 事务测试不能证明数据库回滚。`test/merchant-resort-scope.db-spec.ts` 已增加四项真实数据库验收：selected 分页与收益隔离、self/all 归属与资料停用、四类生命周期事件及审计落库、审计 varchar 约束失败后业务和 Outbox 回滚。该文件已通过 lint/typecheck，因本机 Docker/数据库不可用而未执行，远程 CI 尚未运行。既有 test:db 配置会自动发现它。

范围使用当前请求 Guard 快照；事务内尚未重新解析全部 RBAC，因此不能宣称完成并发撤权保护。MerchantResortService 和 RevenueService 已拆出业务 Repository/事务端口，Prisma 依赖移入 Infrastructure，见 [商家雪场与收益 DDD](merchant-resort-ddd.md)。全局雪场和公开雪场服务的 DDD、文章/社区等其他资源的范围覆盖、D-23 资源目录、真实浏览器/API、对象存储/Kafka/provider 和设备联调仍未全部验收。
