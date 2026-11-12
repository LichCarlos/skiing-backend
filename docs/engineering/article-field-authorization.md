# 文章字段授权与 D-40 字段目录

> 2026-11-01 补充：整体 customFields 不可为 null；受保护管理员字段特权增加 SystemRoleCode 关联复核，self/selected/actor 限正 int4。撤权覆盖全部八入口，知识内容数据库专项现 34 项；见 [文章事务授权与输入边界](article-transaction-boundaries.md)。下文版本与测试数字保留为历史记录。

> 2026-10-30 补充：字段规则不变，文章封面/分类现增加共享引用锁、图片 MIME 与数据库 ID/版本边界；raw 40001/40P01 返回 409。知识内容原数据库文件现 26 项，项目知识 HTTP 另 24 项，详见 [当前写入验收](knowledge-write-validation.md)。

实施日期：2026-10-29。用户已确认 D-40，接口、服务端授权及 Web 动态表单已实现；全项目验收尚未完成。

## 接口与分层

新增 `GET /api/v1/admin/articles/custom-fields`，沿用管理端入口、`content:article:manage` 和 D-39 的 `article` 数据范围。静态路由位于 `:id` 之前。响应为 `{entityType:'article',groups:[{groupKey,label,sortOrder,fields:[]}]} `，字段包含 fieldDefinitionId、fieldKey、label、dataType、groupKey、sortOrder、required、defaultValue、optionsDictType、validation、schemaVersion、canRead、canWrite。仅返回活动分组下当前账号可读或可写的活动字段，省略空组；字典选项继续通过既有获准字典 API 获取。

Presentation 负责 DTO/VO、Guard 和服务端 actor；Application 通过 `ArticleRepository.runRead/runWrite` 编排事务及字段校验；Domain 合并字段 grants，保留 D-39 范围规则；Infrastructure 在实际事务客户端上解析当前授权、读取 schema/选项并持久化。应用层不依赖 Prisma。身份 Principal reader 可接同一事务客户端，HTTP 不接受客户端伪造 actor。

## 字段与范围

有效角色的 CanRead、CanWrite 分别取并集，无 grant 默认拒绝。`all` 只代表记录范围，不授予字段权限；受保护的 `system_admin` 可读写所有活动字段。D-39 仍为 self 按作者、selected 仅指定记录且不能创建、all 全局、merchant 拒绝，多角色范围冲突拒绝，不可见记录 404。

列表、详情、创建、更新、发布和撤回的 `customFields` 只回显可读活动字段，只写字段不回显。未知、停用或未获写权限的提交返回 422。PATCH 省略键时保留数据库原值，包括当前不可见及旧停用字段；显式清空仍受字段类型、required 和 schema 校验。不能把裁剪后的响应整体回写覆盖原始 JSONB。

## 事务边界

读取、字段目录、列表/count 使用 RepeatableRead；写入使用 Serializable。事务内重新读取账号、活动角色、动作权限、管理端入口、资源范围、字段策略、schema 和有效字典选项，验证原始记录并合并更新；版本、Outbox 与 OperationLog 同事务提交。事务中的范围与请求 Guard 传入范围不一致则 403，防止旧请求自动获得更大范围；冲突按既有规则返回 409。图片签名在事务提交后执行。

这是事务快照内的授权一致性。已提交的撤权在新事务中生效；不承诺所有与撤权并发的事务都在撤权之后提交，不能把 Serializable 描述为全局即时撤权锁。

## 验证与契约

- Backend `pnpm check`：107 文件、597 项通过；HTTP `pnpm test:e2e`：3 文件、76 项通过；build/OpenAPI 导出通过。
- 新 HTTP 文件装配真实应用服务及仓储替身，覆盖静态路由、元数据、角色门禁、响应裁剪、只写合并、越权/未知字段及伪造 actor 拒绝；不代替真实数据库验证。
- 独立 PostgreSQL/pgvector：19 个迁移、两次 seed、结构复验与 9 文件/54 项通过。其中 knowledge-content 19 项包含字段策略并集、只读/只写、schema/分组停用、已提交撤权、审计失败回滚及原有 D-39/生命周期规则。详见 [数据库验收](database-validation.md)。
- Web 文章模块 15 项测试、全仓 79 项及双应用构建通过；App 64 项、Doctor 20/20 与三平台导出通过。浏览器/设备/API 业务验收尚未执行。

OpenAPI 为 `1.29.0`；三仓 SHA-256 均为 `51eaa6e1a4a46f855859b2caa400238cccd756c60c2f11a02da1377f967e8cf9`，各客户端已生成本仓类型。无新增依赖或 migration。真实 Kafka、模型/Embedding、存储和全部管理资源的范围/字段授权仍需继续验证或实现。
