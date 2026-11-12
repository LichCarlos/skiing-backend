# RAG 来源实时校验与存量回填

2026-11-04 当前回填验证：正式CLI五类来源、重复跳过、旧索引修复、503后检查点续跑、高水位和人工停用共8项已通过真实PG/BGE-M3；当前复现和边界见[回填验收](rag-backfill-cli-validation.md)。下面旧“尚未执行”与旧版计数仅为当时记录；本轮没有重跑Kafka或DeepSeek。

2026-10-30 历史项目知识补充：项目知识来源复用当前发布校验，违规内容不再进入 Embedding；项目知识快照升级 v2，检索 SQL 拒绝旧 v1，即使源内容未变。安全旧来源须完成 `--source project_doc` 复验回填后恢复；其他来源版本不变。部署顺序、测试与保留数据边界见 [历史知识复验](rag-legacy-project-validation.md)，下文旧兼容说明按历史阶段阅读。

2026-10-30 补充：文章字段现在同时要求定义和所属分组 active、IsPublic=true；来源读取与检索 SQL 使用相同规则。停用/恢复影响有效公开快照，旧索引即时隐藏，重新索引后恢复符合当前投影的内容。新增真实数据库生命周期、无值不误隐藏及排序/LIMIT 前过滤验证，见 [字段分组验收](rag-field-group-validation.md)。下文旧测试数量与环境描述按历史阶段阅读。

> 2026-10-29 后续数据库复验：RAG 真实 PostgreSQL/pgvector 6 项已通过，含当前公开资格、来源快照、真实 Inbox/索引写入与活动租约；Embedding 为固定向量替身。 19 个迁移、两次 seed 和结构复验亦通过。下文旧“未跑”描述保留为当时阶段记录，当前验证范围以 [数据库验收](database-validation.md) 为准。

2026-10-29。实现位于 `domain/rag-source-state.ts`、`infrastructure/rag-source-visibility.sql.ts`、`prisma-rag-candidate-retriever.ts`；无新增 API、migration 或依赖。

## 检索规则

仅检查 RagDocument 的 indexed 状态不足以排除 Kafka 尚未处理的撤回或编辑。五类公开来源的索引现在保存 `Metadata.sourceState`，记录渲染 RAG 文本所用的公开字段。内容哈希包含该快照；不把私有扩展字段写入快照。

候选查询在同一条 PostgreSQL SQL 中校验当前业务源，在排序和 LIMIT 前过滤：

- 雪场：已发布、未软删除，名称、位置、价格、营业、雪况、描述和标签与快照一致。
- 文章：已发布、未软删除，正文及当前 active 且 IsPublic 的扩展字段值、标签与快照一致。收回字段公开权限或修改字段标签会立即排除旧索引。
- 项目知识：已发布、未软删除，标题、正文、分类和来源 URL 一致。
- 动态：已发布、未软删除，作者 active；关联雪场仍已发布且未删除；正文、作者昵称和雪场名称一致。
- 字典：类型 active 且 PubliclyReadable，叶子及同字典祖先均 active；路径无环、到达根、最多 64 层，名称、稳定值和根到叶路径一致。

SourceType、SourceId、SourceKey 也必须与业务源匹配。无快照的旧索引、未知类型及 merchant/admin 私有来源默认拒绝；现有五类 handler 都只生成 public 文档。通用 RBAC scope 解析仍保留，但私有收益等来源尚无权威业务源校验及索引实现，不能仅凭 scope 放行。原始账号、凭证、审计正文不会作为公开索引来源。

这里保证的是本次 SQL 语句快照下的有效性；流式回答生成期间发生的后续业务变更不会撤销已经发送的文本。该方案不等于事务贯穿整个模型调用。

## 升级与回填

旧索引缺少 sourceState，升级后会被隐藏。应用升级并确认数据库、Embedding 配置可用后，在 Backend 根目录执行回填。回填可能调用收费 Embedding 服务；先在专用测试环境核对结果。

```powershell
pnpm rag:reindex --help
pnpm rag:reindex --source all --batch-size 100
pnpm rag:reindex --source article --after-id 19 --batch-size 100
pnpm rag:reindex --source project_doc --batch-size 100
```

支持 `all/resort/article/project_doc/dynamic/dictionary`；批量范围 1–500。需要 `DATABASE_URL`、`EMBEDDING_API_KEY` 和对应模型/地址配置，默认读取本仓库 `.env`。`--help` 不连接数据库或模型。

CLI 不启动 HTTP 或 Kafka，使用进程内 UUID 直接回放现有 handler，保留 Inbox 领取/完成机制，不向 Kafka 投递伪造事件。每类开始取最大 ID，通过 keyset 分页扫描该高水位内所有业务记录；非公开记录由 handler 停用索引。相同内容及模型由原有哈希幂等逻辑跳过。扫描不建立全库长事务，新增或并发变化仍由事件流程或后续回填处理。

成功处理一条后输出 `{source,lastProcessedId}`。失败停止，输出失败类型与 ID，不打印供应商原始错误或凭证。恢复时选择单个 source，以最后成功的 ID 作为 `--after-id`；失败行必须重新处理。all 模式不能用一个 ID 跨类型恢复；高水位也不会持久保存。分页读取错误时可按最后已输出进度恢复或重跑该类型。

## 验证与剩余工作

纯领域、索引哈希/Metadata、SQL 构造与回填参数/顺序/恢复失败测试已通过。`test/rag-source-visibility.db-spec.ts` 提供四项真实 PostgreSQL/pgvector 验收，覆盖五类业务源、同毫秒变更、公开字段撤权和字典路径；仅在专用已迁移数据库运行 `pnpm test:db`。本机 Docker engine 未运行，真实 SQL 与回填尚未执行，不以替身测试代替数据库验收。

关联对象更新尚未全部自动触发依赖文档重建；实时校验会隐藏过期结果，可用回填恢复。物理删除业务行留下的孤立 RagDocument 不在源表扫描中，当前查询会排除，物理回收仍待实现。大正文 JSONB 比较、字典递归、pgvector 过滤后的召回率与查询计划需要真实数据性能测试。真实 Kafka/provider、并发索引和端到端引用验收仍待完成。
