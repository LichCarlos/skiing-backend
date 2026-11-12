# 知识内容 DDD 与文章数据范围

> 2026-10-30 最新增量：项目知识五类写命令在 Serializable 事务内复核受保护管理员、入口和动作权限；敏感元数据/来源 URL 与发布前存量复核、ID/版本边界已补齐。文章图片/分类引用增加共享锁、MIME 和 raw 冲突映射。知识内容专项真实数据库现为 50 项，见 [写入授权与验证](knowledge-write-validation.md)。下文旧数字为历史记录。

> 当前补充：D-40 字段目录、有效角色字段权限及事务内完整 RBAC/schema/选项重载已实现，知识内容真实数据库现为 19 项通过。详见 [文章字段授权与当前验证](article-field-authorization.md)。以下正文为 D-39 首次交付的历史快照，其中“未跑/字段策略或事务重载待完成”不再代表文章当前状态；前端有效范围投影仍缺。

> 2026-10-29 后续数据库复验：知识内容真实 PostgreSQL 6 项已通过，涵盖 D-39、作者/首次发布、审计/Outbox/回滚、公开分类与项目知识版本。 19 个迁移、两次 seed 和结构复验亦通过。下文旧“未跑”描述保留为当时阶段记录，当前验证范围以 [数据库验收](database-validation.md) 为准。

实施日期：2026-10-29。负责人：后端接口负责人。状态：业务代码、单元和 HTTP 替身验证通过，真实 PostgreSQL/页面与外部服务验收待完成。

## 模块职责

| 层                    | 代码                                                                                                                  | 职责                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Presentation          | `presentation/http/` 的文章、项目知识、公开文章 Controller/DTO/VO                                                     | HTTP 校验、身份/动作门禁、服务端范围传递、审计上下文和响应协议              |
| Application           | `admin-article-service.ts`、`project-knowledge.service.ts`、`public-article-queries.ts`                               | 用例编排、范围复核、动态字段校验、版本与生命周期、公开投影、提交后 URL 签名 |
| Application 端口/模型 | `ports/article-repository.ts`、`project-knowledge-repository.ts`、`public-article-reader.ts`、`content-models.ts`     | 持久化无关的记录、分页和事务能力；Asset ID 用字符串，不泄漏 Prisma 类型     |
| Domain                | `domain/content-rules.ts`、`article-scope.ts`、`project-knowledge-validation.ts`                                      | 纯 TypeScript 的状态转换、分页、文章归属、项目知识内容校验                  |
| Infrastructure        | `prisma-article.repository.ts`、`prisma-project-knowledge.repository.ts`、`prisma-public-article.reader.ts`、辅助文件 | ORM/BigInt 映射、范围 WHERE、引用复核、快照/事务、审计和 Outbox             |
| 装配                  | `knowledge-content.module.ts`                                                                                         | 三个应用端口绑定实际 Prisma 适配器                                          |

KnowledgeContent 全部 Application 生产文件已移除 Prisma、共享持久化服务、Infrastructure 和 HTTP DTO 导入；Domain 不依赖 Nest/Prisma。应用层仍使用 Nest DI/异常适配。跨上下文只使用 AssetStorage、CustomFieldRepository 应用端口、字段与授权领域规则。AST 门禁见 `test/architecture/knowledge-content-boundaries.spec.ts`，覆盖静态/类型/动态导入并拒绝计算导入；其他上下文不因此视为完成。

## D-39 文章授权

用户已确认资源键 `article`：self 按 AuthorId 本人，selected 仅指定文章 ID 且不能创建，all 全局，merchant/缺失/非法范围拒绝。Guard 按实际角色 grants 解析，范围冲突继续拒绝；Controller/Application 都检查支持的范围，创建再拒绝 selected，并核对 self 范围主体与审计主体一致。作者由服务端固定为创建账号，不接收作者 DTO。

Prisma 适配器在列表/count、详情和事务内读取/更新使用相同范围。selected 的集合条件与单条目标以 AND 并存，客户端目标不会覆盖集合。不可见目标 404；乐观版本条件变化返回 409。身份权限仍由请求期快照给出，尚未在业务写事务内重新解析完整 RBAC，不能宣称解决并发撤权。

CurrentUserVO 没有有效数据范围，前端目前仅按动作 grant 显示文章入口/创建按钮，无法预先隐藏 selected 创建或 merchant 文章入口；服务端会拒绝这些操作。未新增或猜测范围能力接口，也不以角色名称推断。

## 持久化与公开查询

文章和项目知识的业务写入、版本递增、Outbox 和 OperationLog 共用 Serializable 事务；P2034 转 409，不自动重试旧预读。文章分类必须属于 `knowledge.article_category` 且 item/type active、type publiclyReadable，封面必须 ready，这些引用校验已由事务外移入写事务。管理员封面继续允许任意 ready Asset；本轮没有更改图片 owner 契约。

更新保持现有发布状态；显式发布/撤回/软删除保持既有状态机。首次发布设置 PublishTime，重新发布保留首次时间；项目知识更新仍要求客户端 version，文章使用服务端读取版本。审计查询 active 操作者，失败传播并由真实事务负责回滚。签名 URL 在事务成功后调用，事务内不调用对象存储、Kafka publish 或模型。

管理文章、项目知识和公开文章列表/count 使用 RepeatableRead，保留各自既有稳定排序与分页。公开文章还要求 published、未删除、非空 PublishTime、分类和类型公开有效。本次修复公开分类查询遗漏 DictType 的问题，避免其他公开字典的项目混入文章分类；列表和详情同样限定分类类型。公开 VO 不返回 customFields、作者 ID、版本或内部引用信息。

动态字段 schema/选项值仍在请求期通过端口读取，事务中尚未重载完整 schema/字段授权策略。项目知识沿用既有内容模式检测，不能当作完整隐私识别或 HTML 安全证明；仍需审核。RAG consumer 的来源校验、Kafka Inbox 和事件名称没有更改。

## 验证范围

- 应用端口测试覆盖范围拒绝、范围传递、隐藏目标 404、selected 创建拒绝、版本失败无后续事件/审计、事务引用失败、审计失败不签名、编辑保留 published、首次发布/重发、项目知识软删除和输入错误。
- Infrastructure 测试覆盖 self 分页/count、selected 目标交集、事务引用、Serializable/P2034、公开分类 DictType 及公开状态、事件和审计编排。旧 Prisma 测试已迁入 Infrastructure，新应用测试仅依赖业务端口。
- HTTP 新增 4 组范围测试及 1 组多角色冲突测试，检查真实 Guard/Controller 的范围转交和拒绝；业务服务使用替身，不冒充数据库隔离证明。
- `test/knowledge-content.db-spec.ts` 新增 6 项实际 PostgreSQL 验收，覆盖 self/selected、创建作者、生命周期/Outbox/审计、审计失败回滚、公开分类隔离/停用和项目知识版本/回滚。已纳入既有 test:db/CI 自动发现，并通过 lint/typecheck；本机既有 Docker/数据库不可用，尚未执行，远程 CI 也未运行。

最新 Backend check 101 文件/518 项、HTTP 2 文件/68 项通过；构建与三仓复验结果见项目交付记录。OpenAPI 仍为 1.28.0，SHA-256 `61ede5b5214de4f47c1631b12ce5735384fed0fe1c26ac8d3a4c1f43db7c0c4e`。本次新增授权业务规则已写入唯一详细契约；没有新增 HTTP 字段/路由、依赖或 migration。

真实 PostgreSQL migration/事务并发、Kafka/Embedding/provider、浏览器/设备/API 成功流程和文章动态字段的完整授权范围仍待实施或验证，项目整体未完成。
