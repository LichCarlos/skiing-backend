# 历史项目知识的 RAG 复验

实施日期：2026-10-30。负责人：后端接口负责人。范围：现有项目知识公开资格与索引内部版本；无新 HTTP API、数据库迁移或依赖。

## 行为与工程边界

原项目知识来源读取只检查业务记录存在，后续处理器检查 published、未删除和首次发布时间。历史已发布记录即使不满足当前写入规则，也可被重新 Embedding；与原始业务内容完全匹配的旧索引仍可进入对话上下文。

KnowledgeContent 的公开适配端口 `application/ports/public-project-knowledge-policy.ts` 复用既有领域发布校验。AiAssistant 的 Infrastructure 在读取项目知识时调用该端口；Domain/Application 不跨层依赖其他模块的持久化或 HTTP 类型。标题、正文、分类、来源 URL 全部通过同一套现有规则，才返回可索引来源。确定性的内容拒绝返回空来源，现有 handler 停用索引、删除分块并完成 Inbox；数据库等非内容异常继续抛出、释放租约，供正常重试。

校验输出不替换原始数据库内容。来源快照保留原始空白、URL 等值，保证检索 SQL 与数据库记录精确匹配；规范化写入仍由内容用例负责。这里没有修改管理员可编辑的业务状态或正文。

项目知识 sourceState 从 v1 升为 v2，版本由 PROJECT_RAG_POLICY_VERSION 统一提供给快照和 SQL；其他四类来源继续 v1。查询在向量排序及 LIMIT 前只接受当前版本和当前业务内容完全匹配的项目知识。旧 v1 即使仍 published/indexed 且内容未变，也不能进入模型请求；安全旧内容通过来源适配器复验并重建 v2 后恢复。内容哈希包含 sourceState，旧快照不会因相同正文而跳过重建；后续相同 v2 内容仍幂等跳过。

若未来修改项目知识公开规则，需要同步升级内部策略版本并安排复验；不能仅收紧新写入校验而继续放行旧快照。来源在校验之后并发变化时，当前源内容比较会排除不匹配索引；模型已经收到的上下文不能事后撤回。

## 升级与回填

升级检索服务后，所有项目知识 v1 索引先隐藏，包括安全旧知识。这是明确的升级行为；本轮不自动调用真实 Embedding 或改写业务内容。在配置好专用环境的 DATABASE_URL、EMBEDDING_MODEL/服务地址和密钥后，于 Backend 根目录运行：

```powershell
pnpm rag:reindex --source project_doc --batch-size 100
```

使用现有 CLI/Inbox/handler 流程；不需要 migration，也不靠手工改 Metadata 版本恢复。安全来源重建，违规来源停用；缺少 provider 配置或供应商失败时，按既有 CLI 最后成功 ID 恢复规则处理，见 [实时校验与回填](rag-source-visibility.md)。滚动发布仍运行旧 reader 的实例只能写出 v1，新检索规则会拒绝该快照；完成后端实例升级后再回填。

此校验是已有规则的确定性模式筛查，不能检测全部隐私或凭证格式，也不替代人工语料审核。停用会清除向量分块，但已有 RagDocument 的正文/Metadata 和原业务记录不会被自动擦除；保留数据的治理与删除需要独立方案。不得据此宣称全量历史语料已经审查或清除。

## 回归证据

修复前新增 8 项真实 PostgreSQL 回归全部失败：匹配的旧快照仍可检索；项目来源适配器另有 10 项违规内容单测失败。修复后来源真实库专项为 17 项，覆盖旧标题/正文/分类/URL/私钥、无内容修改时立即隔离、重放停用并清空分块、安全旧知识恢复、原始空白/URL 身份、哈希升级和重复事件幂等。

新增 2 项真实登录/HTTP/SSE/pgvector 联合测试：旧 v1 不进入引用或 Chat 请求；安全内容复验后恢复 project 引用；违规内容重放不调用 Embedding，也不调用 Chat，对话持久化不包含来源中的敏感测试标记。外部模型与 Embedding 使用替身，其他链路为真实实现。最初联合测试模块遗漏索引处理器提供者，补齐真实 reader/Inbox/writer 装配；未修改生产模块的生命周期或启动 Kafka。

来源适配器测试还覆盖持久化失败继续抛出且不确认 Inbox。DDD 依赖门禁保持有效；没有放宽 Domain/Application 的跨上下文依赖。

## 最终验证（2026-10-31）

三仓分别冻结安装通过。Backend lint/typecheck、118 文件/827 单测、3 文件/85 HTTP 测试和 build 通过；最终完整数据库复验为 26 文件/481 项通过。完整库首轮 479 通过/2 失败来自联合测试提供者装配；补齐后专项另暴露测试断言直接序列化 BigInt，已改为仅检查实际正文与引用，最终两项及完整数据库套件均通过。生产业务断言未放宽，最终 lint/typecheck 亦复验通过。

Web 完整 check 187 项及官网/Admin production build 通过；App 完整 check 99 项、Doctor 20/20 和 iOS/Android/Web export 通过。三仓 OpenAPI 仍 1.39.0，SHA-256 均为 bd9f3a624ab2263966bc4e9b6a33bd677e735af94f27ff44b446b2ba5a9e9444；无依赖或 migration 变更。完整数据库测试前后 db:verify 通过，仍为 20 迁移。

专用验证库沿用并核验 linji-events-validation-20261030，完整容器 ID 45a28641a1d2f357f3ce5c088e8f3a876433d34d43d4a8b4f76c0c09ddb7f3a2、pgvector/pgvector:pg17、loopback 53240。测试自建来源与账号由 finally/afterAll 清理；只读复核本阶段项目知识 fixture、孤立项目知识索引、RAG 字段分组均为 0。原 3010/3001 开发进程仍为 49660/60192，验证库与 App dist-events-validation 保留。

本地 Backend 忽略日志 legacy-rag-*.log 保留各轮记录，最终数据库结果以 legacy-rag-db-final.log 为准。未启停用户服务、修改 .env、提交、推送或部署；未调用真实收费模型。文档收尾检查 87 份 Markdown、458 个本地链接，无断链。

## 尚未完成

真实 provider 回填、召回质量、人工全量语料审查、在途模型来源撤回、并发索引代际控制、RAG 管理 API/页面和性能验收仍未完成。RAG 运维及全局雪场字段/资产授权精确协议继续等待已有提案确认，本次内部索引修复不实施待定协议。
