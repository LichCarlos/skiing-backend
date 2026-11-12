# 全局雪场管理的数据范围

> 2026-10-30 当前增量：五类写事务已重新解析当前 RBAC、入口/动作权限及 resort all；撤权、范围收窄/冲突、引用竞争和审计回滚新增 27 项真实 HTTP/数据库测试通过。原三项范围夹具现使用独立真实角色/grants。字段策略及全局资源授权尚需补齐，详见 [事务授权与实际边界](admin-resort-transaction-authorization.md)。下文为原阶段记录。

> 2026-10-29 后续数据库复验：全局雪场真实 PostgreSQL 3 项已通过，含范围、审计与回滚。 19 个迁移、两次 seed 和结构复验亦通过。下文旧“未跑”描述保留为当时阶段记录，当前验证范围以 [数据库验收](database-validation.md) 为准。

2026-10-29；沿用 OpenAPI 1.28.0 和已有 API-M05 契约，没有新增接口、字段、依赖或 migration。

## 已有契约与缺口

全局管理 `/admin/resorts` 要求对应 `content:resort:*` 动作权限与 global scope。此前 Guard 已解析 `resort` 范围，但 Controller 未消费结果，Application 也未检查，拥有动作权限的 self/merchant/selected 角色可能执行全局操作。

现在七类操作——列表、详情、创建、编辑、软删除、发布和下架——均显式要求解析后的 `resort.kind=all`。Controller 在调用用例前拒绝，Application 的每个公开方法再次检查，缺少范围也拒绝。范围只由服务端 Guard 传入，不能由 query/body 填充。`all` 不免除 portal 或具体动作权限；不按 system_admin/merchant 等角色名称判定。商家接口仍由 MerchantProfile 与授权限定，不因本次修复获得全局权限。

只要不是 all，即使 selected 包含目标 ID 也返回 403；这是已有全局接口契约。商家 selected 已按 D-38 另行实施，见 [商家范围与审计](merchant-resort-scope.md)；受限角色的通用行级管理和资源目录 D-23 仍未完成。

## 实现

`domain/resort-management-scope.ts` 提供纯范围判定，Controller/Application 分别映射为 403。Application 方法强制接收范围参数，不提供默认为 all 的兼容入口。检查在查询、字段校验、签名 URL、事务、Outbox 和审计之前进行；原有合法 all 操作的分页、生命周期、事务审计与事件逻辑保持。

后续已完成 AdminResortService 的业务仓储端口与 Prisma 适配器拆分；引用校验、业务写入、Outbox 和审计同 Serializable 事务。公开查询也拆出读取端口并使用数据库排序分页，见 [全局与公开雪场 DDD](global-public-resort-ddd.md)。范围来源仍是本次请求的服务端授权快照，尚未实现业务写事务内重新解析全部 RBAC 的撤权并发保护。

## 验证与限制

Application 新增四组范围测试，每组检查七个入口拒绝且不访问数据库/字段查询、不写 Outbox/审计。HTTP 新增四组，通过真实 Guard 解析自定义角色的显式资源范围，覆盖三种非 all 拒绝及 all 成功，共 28 个请求；已有无动作权限拒绝和管理员流程继续通过。HTTP 使用业务服务替身，不是数据库或浏览器端到端验收。

`test/admin-resort-scope.db-spec.ts` 已纳入 test:db/既有 CI：现为三项真实数据库验收，覆盖所有拒绝不落库、all 创建/读取/更新/发布/下架/软删除、五条写入的 Outbox 与审计，以及审计失败时更新/Outbox 回滚。用例使用专用已迁移数据库、唯一命名 fixture 和实际 Prisma/Outbox/字段仓储；没有图片，所以存储适配器在被调用时会失败，不冒充对象存储验收。本机 Docker 启动故障尚未解决，文件未执行，远程 CI 也尚未运行。

浏览器/API 成功流程、真实数据库事务并发、Kafka 消费与对象存储仍待验。本次不涉及前端协议或生产启动，也未更改用户现有开发进程。
