# RAG 来源端口、Inbox 与 Kafka 生命周期

2026-10-30 历史知识补充：AiAssistant Infrastructure 经 KnowledgeContent 的公开策略端口复用既有发布校验，不增加内层跨上下文依赖。项目知识快照升级 v2，旧 v1 在复验回填前隐藏；其余来源继续 v1。见 [历史知识复验](rag-legacy-project-validation.md)；下文关于全部快照兼容的描述仅对应当时阶段。

2026-10-30：文章字段定义及所属分组均须 active，且字段 IsPublic=true，才纳入 sourceState、索引文本和当前检索公开投影。停用/恢复分组的真实 reader/Inbox/pgvector 生命周期与 LIMIT 前过滤验证见 [字段分组验收](rag-field-group-validation.md)；未新增应用层跨上下文依赖。

实施日期：2026-10-29。负责人：后端接口负责人。状态：实现及单元/HTTP/真实 PostgreSQL 验证通过；真实 Kafka、模型与页面设备联调仍待完成。

## 分层

五类来源处理器（雪场、文章、项目知识、公开动态、公开字典）通过 `RagSourceReader` 读取中性 camelCase 记录，通过 IntegrationEvents 的 `InboxLease` 端口领取/完成/释放租约。它们不再依赖 PrismaService、PrismaInboxExecutor 或其他 Infrastructure。`PrismaRagSourceReader` 集中处理 SQL 投影与 ORM 记录映射，文章及公开字段定义、字典类型/项目/祖先链各自使用 RepeatableRead 快照。雪场/动态沿用嵌套投影查询；项目知识只取用于索引的字段。

`sourceState` 的既有 JSON 键保持兼容，由 Infrastructure 使用既有纯领域函数构造，避免本次重构使存量向量全部失效。应用层负责公开资格判断、内容拼接、来源键、索引与停用编排。`rag-reindex.ts` 作为后端 CLI 装配同一个适配器和端口。Module 注册 source reader 与 Inbox token，HTTP 契约没有变化。

AiAssistant 全部生产 Application/Domain 纳入 AST 门禁：禁止 Prisma、Infrastructure、HTTP DTO 和计算导入进入内层；应用层允许 Nest DI/Config 与 node:crypto，以及明确的 IntegrationEvents 应用端口/领域事件和身份领域规则。Domain 仍为纯 TypeScript。此门禁不表示所有其他上下文已完成分层。

## 公开资格与检索

文章索引现在与 API-K01/收藏一致：published、未软删除、PublishTime 非空，分类属于 knowledge.article_category，字典项/类型 active，类型 publiclyReadable；项目知识要求首次发布时间已写入。通用 RAG 仍只生成 public 来源，收益/认证/配置/操作日志不进入通用索引。字典必须有完整有效父级链，循环、缺失或超过 64 层均停用，不以部分路径建索引。

检索 SQL 在排序/limit 前再次检查文章分类公开状态和文章/项目发布时间，所以分类停用/转私有无需等待 Kafka 才能隐藏已有向量。其余既有 sourceState 对比继续阻止旧正文、旧公开字段、停用作者/雪场关联等来源进入上下文。这里验证查询时的快照，不宣称模型已经收到的上下文可被事后撤回。

## 消息可靠性修复

旧 Inbox claim 返回 null 同时表示“已完成”和“有活动租约”，处理器都返回 false，Kafka 可能把尚未完成的事件当作成功交付。本次 `claimRagEvent` 仅在 isProcessed 为真时跳过；活动未完成租约抛 RagInboxBusyError，不释放他人租约，也不允许 commit。自身处理失败或完成 token 丢失时释放自身租约并传播原失败。真实 PostgreSQL 验收发现领取 SQL 的 LockToken 参数缺少 UUID cast，已补 `::uuid`，重复/活动租约查询可执行。

另一个实际生命周期错误是 `await consumer.run()` 返回后立刻进入 finally/disconnect；已核对安装的 KafkaJS 2.2.4 源码，run 只等待 startup。现在启动后等待 CRASH 或应用关闭；外层负责重连，关闭时注销监听并取消重试等待。五类处理器均成功后才提交 BigInt 安全的 offset+1。KafkaJS 内部 restartOnFailure 被关闭，避免与外层重复恢复。

保持 at-least-once：Embedding 是事务外副作用，崩溃/租约过期仍可能重复调用；向量写入使用既有来源键/哈希条件和事务。没有承诺端到端 exactly-once，也未新增 DLQ、管理员重试或新的 HTTP 契约。

## 验证

原五类带 Prisma 替身的处理器测试迁到 Infrastructure，并实际装配 PrismaRagSourceReader；新增应用端口测试覆盖五类来源的完成重复、活动租约拒绝、失败释放、原错误保留、完成 token 丢失。适配器测试覆盖公开字段白名单、文章分类/发布时间、快照和字典完整链/深度上限。Kafka SDK 替身测试验证启动后保持连接、handler 失败不提交、成功 offset、CRASH 重连及关闭取消等待；日志中的 broker unavailable/again 是注入失败，不是本机真实 broker 报错。

`test/rag-source-visibility.db-spec.ts` 从 4 项增至 6 项，新增真实 reader/Inbox/indexing/writer 流程与重复事件、分类撤销停用/清空 chunks、活动租约不完成后释放重试；既有检索测试增加分类停用/私有和 PublishTime 空值过滤。Embedding 使用固定 1024 维向量替身，不调用实际 provider。完整本地 test:db 已通过 9 文件/41 项，覆盖此前雪场/角色/知识/收藏/社区/会话验收；详见 [数据库验收记录](database-validation.md)。

本次没有新增依赖、migration、HTTP 路径或字段。OpenAPI 仍为 1.28.0，三仓哈希相同；远程 CI、真实 Kafka/provider、页面设备成功工作流及性能/并发撤权仍未验收。
