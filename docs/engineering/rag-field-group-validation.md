# RAG 文章字段分组停用验收

后续阶段已补齐历史项目知识的索引入口复验和旧 v1 快照检索隔离；见 [历史知识复验](rag-legacy-project-validation.md)。下文关于该缺口的描述保留为本阶段当时的边界，人工语料审查仍未完成。

实施日期：2026-10-30。负责人：后端接口负责人。范围：落实既有活动字段/分组与公开投影约束；无新增 HTTP 协议、依赖、迁移或 OpenAPI 版本。

## 问题与修复

原文章来源读取和检索 SQL 只要求字段 active、IsPublic=true，遗漏字段所属分组的活动状态。停用分组不改变文章正文或字段定义，旧 sourceState 因而仍能匹配，分组中的值仍可能进入 AI 上下文。

`PrismaRagSourceReader.findArticle` 现在同时要求 Group.Status=active，文章与有效字段定义仍在同一 RepeatableRead 快照读取。`currentPublicRagSource` 对 CustomFieldGroup 使用 EntityType、GroupKey 复合关联，并在构造当前公开字段快照时过滤停用分组；校验发生在向量排序和 LIMIT 之前。其他实体的同名活动分组不能使文章分组通过校验。

sourceState 保持 v1 和既有结构，活动分组已有索引无需全量失效。分组停用后，包含其字段的旧索引即时隐藏；通过现有业务事件或 rag:reindex 重建后，文章其余公开内容可再次检索，分组字段不出现在新 Metadata 或分块中。分组恢复后，缺少恢复字段的快照再次隐藏，重新索引后恢复。文章没有存储该分组字段值时，公开投影没有变化，仍可检索。

## 回归证据

修复前，新增真实 PostgreSQL/pgvector 生命周期测试在“分组已停用但旧索引仍可见”处失败；读取适配器单测也因查询缺少 Group 状态条件失败。修复后专项 9 项真实库测试、文章来源/候选检索 12 项单测通过。

本阶段真实库新增 3 项，覆盖：停用前后 reader→Inbox→固定向量 Embedding→writer→SQL 检索、重建时 Metadata/ChunkContent 排除标记、恢复与重新索引；无分组值的文章不误隐藏；最相似来源被停用后，limit=1 仍返回次近合法来源。最后一项使用不同轴向量验证 SQL 过滤先于 LIMIT，避免只在应用层丢弃越权结果导致正常证据缺失。

测试创建唯一命名的文章、字段、分组、Inbox 和 RAG 记录，最终清理自建记录；组/字段状态在 finally 中恢复。首次扩展同名分组 fixture 时误用了资源键 resort，真实数据库实体检查约束拒绝；已改用既有实体键 ski_resort，未修改约束。

## 边界与剩余工作

本阶段最终验证：三仓各自 pnpm install --frozen-lockfile 通过；Backend lint/typecheck、118 文件/816 单测、3 文件/85 HTTP、26 文件/471 真实 PostgreSQL 测试与 build 通过。完整数据库测试前后 db:verify 通过，仍为 20 迁移。Web 完整 check 187 项及官网/Admin production build 通过；App check 99 项、Doctor 20/20 及 iOS/Android/Web export 通过。固定向量替身不代表真实模型召回质量。

三仓 OpenAPI 1.39.0 SHA-256 均为 bd9f3a624ab2263966bc4e9b6a33bd677e735af94f27ff44b446b2ba5a9e9444。本轮日志在 Backend 本地忽略文件 rag-groups-*.log；导出保留于 App 的 dist-events-validation。已核验专用验证库容器身份、loopback 53240 和 pgvector/pgvector:pg17；原 3010/3001 开发进程仍为 49660/60192，未启停服务、修改 .env、提交、推送或部署。

只保证检索 SQL 语句快照下的公开投影；已发送给模型的上下文不会因之后停用而被撤回。停用会隐藏过期来源，但分组变化尚不保证自动派发所有依赖文章的重建事件；需要现有回填流程或后续事件更新恢复合法内容。本轮未调用收费 Embedding 服务或修改存量业务数据。

项目知识写入与发布已有敏感文本规则，但本轮未审计历史已发布/已索引知识，也未增加旧内容的读取期敏感检测；不能把写入规则视为存量语料安全证明。雪场标签及其他来源的依赖公开性、全量语料审查与真实召回质量仍需继续核查。

RAG 运维、全局雪场字段与资产授权的新协议仍待原有方案确认；工作台、会话审计、真实模型/存储/设备、性能和生产恢复等整体验收尚未完成。
