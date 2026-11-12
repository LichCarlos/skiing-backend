# AI 管理运维接口

2026-11-03 RAG来源读取与命令核对续验配套：用户已确认D-52，[存储引用声明](audit-citations-contract.md)修正并同步1.51.1/143操作；审计HTTP36项（新增7）、完整HTTP/框架173项、1220单测及构建通过，见[本轮摘要](../validation/rag-source-lifecycle-20261103.json)。本轮未重跑真实PostgreSQL/管理HTTP，以下数据库和浏览器记录按原阶段保留。

## 2026-11-02 真实数据库验收增量

已在专用 PostgreSQL 17.11 / pgvector 0.8.7 全新库应用23项迁移、两次seed并通过结构校验。新增会话审计11项真实HTTP/PostgreSQL测试、RAG控制14项真实事务/pgvector/Inbox测试，均通过。修复raw SQL并发冲突被Prisma包装为P2010后漏映射409的问题；新增6项回归，Backend完整check128文件/1017项通过。完整验收结果、复现命令与剩余边界见[数据库验收](ai-operations-database-validation.md)。真实模型、Kafka生产恢复与浏览器仍待验收。

## 历史 HTTP 验收增量（2026-11-02 较早阶段）

新增 [AI 会话审计 HTTP 套件](../../test/ai-conversation-audit.e2e-spec.ts)，29 项通过。真实 Nest 路由、认证/授权 Guard、DTO、应用服务与响应/异常中间件参与测试，仅替换持久化端口。覆盖独立正文 grant 与管理入口、非内置角色、原因 trim/边界、非法筛选/UUID、认证主体传递、最少元数据与 no-store、软删除元数据、事务拒绝/审计失败不泄露正文及无管理员删除/恢复/导出接口。

完整 HTTP 套件现为4文件/126项通过；同时修正旧回归中的8处 OpenAPI 1.48.0断言为已定版1.49.0，并补齐全局雪场 list/get 的服务端操作者参数断言。Backend 冻结安装、lint/typecheck、128文件/1011项单测及 build 通过。没有修改 API、依赖或数据库迁移。上述端口替身不能证明 PostgreSQL 事务回滚、SQL范围过滤或迁移通过；本机 Docker Linux engine 管道不存在，本次未执行真实数据库测试或迁移。

对应已定版 D-46/API-AI-03 与 D-47/API-AI-04。上方历史阶段的Docker不可用/迁移未执行仅描述当时状态；当前数据库证据见本文开头，浏览器及真实模型/Kafka运维联调仍待验收。

## RAG 来源运维

`GET /admin/ai/sources` 和 `GET /admin/ai/sources/:id` 只返回来源元数据、当前业务可见资格和索引统计，不返回来源正文、chunk 内容、向量、provider 错误或凭证。管理写入由仓储在事务内重新解析管理入口、内置 `system_admin` 身份及对应 grant；列表/详情需要 `ai:knowledge:list`，重建需要 `ai:knowledge:reindex`，人工启停需要 `ai:knowledge:disable`。

重建命令通过 `expectedVersion` 做乐观并发检查，并在同一 Serializable 事务修改控制版本、推进索引代次、写 Outbox 和成功操作日志。启用人工索引创建同一事务事件；停用则原子清除 chunks、推进代次并记审计，不调用 Embedding。重复提交当前开关状态不增加版本、不重复审计。来源操作不能改变雪场/文章/动态的业务发布状态。

`RagSourceReindexEventHandler` 领取 Inbox 租约后复核命令版本，再从业务读取端口重新确认来源身份及公开资格；已过期命令不做副作用，不合格来源清除索引，合格来源强制重建。writer 在开始索引时领取新 `IndexGeneration`，提交 chunks 和标记成功/失败时再次比较 generation、控制版本、内容 hash 及 `ManualDisabled`。因此较旧的 Embedding 工作不能覆盖新命令。检索 SQL 在候选排序/limit 前排除人工停用来源。外部 Embedding 调用仍是 at-least-once，不承诺 exactly-once。

数据库 schema/migration 位于 `prisma/schema.prisma` 与 `20261101000300_rag_source_controls`；最新已在新建隔离库验证全部23项迁移与RAG控制列/约束。没有迁移开发或生产数据库；环境与实测边界见[数据库验收](ai-operations-database-validation.md)。

## AI 会话审计

`GET /admin/ai/conversations` 与 `GET /:conversationId` 只选取会话 ID、所属用户 ID、创建/更新时间、软删除时间及持久化消息数。访客会话排除在外，软删除但仍保留的记录可按筛选读取。仓储在 RepeatableRead 快照重新读取管理入口、permission grants 和 `user` 资源范围；正文命令同时要求 list/read-content 两项授权并取两者范围交集。merchant、未知或角色间冲突范围 fail-closed；缺失和范围外目标统一 404。

`POST /:conversationId/content-access` 接收 trim 后 1–500 字原因。读取已持久化消息和写成功 `OperationLog` 在同一个 RepeatableRead 事务完成；日志记录操作者快照、会话目标、userId、原因与 traceId，不复制正文/citations。审计插入失败时事务抛错，控制器不会返回正文。接口没有管理员删除、恢复、批量读取或导出能力。

管理端只在组件内存短暂保存正文；加载元数据、切换身份、页面隐藏或离开时清除并取消在途请求。正文请求设置 `no-store`，每次都要独立输入原因。UI grant 仅用于显示/隐藏操作，不替代服务端复核。

## 验证

- Backend：RAG 重建事件新增 6 项单测；AI 会话审计仓储/application 共 10 项单测。当前后端全量单测通过；另运行 typecheck、lint。
- Web：AI 运维权限、输入模型与深链接共 8 项测试；全 monorepo typecheck、lint 通过。`pnpm check` 包含该专项。
- Web/App/Backend 消费侧 OpenAPI 快照统一为 1.49.0，SHA-256 为 `9168fb665aa3c3e494be26d1429b7a76bc3869472fc25995d27443085e0c215a`；类型由各仓独立生成和校验。
- PostgreSQL迁移和事务/SQL专项已有隔离库通过证据；Kafka生产故障恢复、真实Embedding provider、管理员浏览器工作流和响应式视觉仍待专用环境验收。
