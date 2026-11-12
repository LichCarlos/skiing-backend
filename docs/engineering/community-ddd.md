# Community DDD 分层与事务

2026-10-30 后续修复：全部 11 种社区写命令已增加事务内 authorize 端口，复用现有 RBAC；图片/雪场引用校验增加 FOR SHARE，raw 40001/40P01 有限重试。具体行为、53 项真实数据库专项与证据限制见 [事务内授权和引用并发](community-transaction-authorization.md)。本段优先于下方历史阶段描述。

2026-10-30 当前实现与验收以 [社区 HTTP/PostgreSQL 验收](community-validation.md) 为准，OpenAPI 1.38.0。下文为分层重构阶段的历史记录；其中 1.27.0、未执行数据库、仅过滤 ready 图片等描述不再代表当前状态。

本阶段 Domain/Application 增加运行时正文类型/码点长度、非空 PATCH、正 int4 ID、分页 skip 边界及规范游标校验。DTO 对 content/images/reason 的显式 null 拒绝；只有编辑 resortId 允许 null 解绑。公开与本人图片均再次限制 owner、ready 和 JPEG/PNG/WebP；imageCount 只计可返回图片。公开信息流/详情与本人列表/详情的动态和个人点赞关系放入同一 RepeatableRead 快照，公开响应 private,no-store。

用户已确认统一最多 9 图，DTO 与领域规则均已限制；未增加 community 资源范围。逐用例重新授权与引用行锁已在上述后续阶段补齐，全域即时撤权与生产负载仍未验。

> 2026-10-29 后续数据库复验：社区真实 PostgreSQL 5 项已通过，涵盖动态/图片、本人编辑与审核审计；未证明全域 scope 完成。 19 个迁移、两次 seed 和结构复验亦通过。下文旧“未跑”描述保留为当时阶段记录，当前验证范围以 [数据库验收](database-validation.md) 为准。

2026-10-29；本次结构调整保持 OpenAPI 1.27.0，不新增 HTTP 路由、字段或 migration。

`presentation/http` 负责现有 DTO/VO、认证主体与 Guard；Controller 调用 Application。`application/community-models.ts` 定义用例输入与持久化无关的结果；与 DTO 结构兼容，不导入 Swagger/class-validator。`domain/community-rules.ts` 只包含 TypeScript：正文规范化、Asset ID 唯一性/BigInt 边界、作者编辑审核状态及动态/评论审核转换。

Application 通过 `CommunityUnitOfWork`/`CommunityTransaction` 编排写入及 Outbox/审计，公开和管理查询分别使用 reader port；本人查询沿用 `OwnDynamicsReader`。Domain 不依赖 Nest 或 Prisma；Application 保留 Nest DI 和异常适配，但不依赖 HTTP DTO、Prisma、共享持久化或跨上下文 Infrastructure。

`PrismaCommunityUnitOfWork` 以 Serializable 事务实现端口。创建时的 ready/owner 图片及公开雪场校验、动态、图片顺序与 `dynamic.changed.v1` 事件在同一事务内；不再先在事务外校验引用。编辑、删除、点赞、评论与审核也通过该事务端口执行。审核与软删除的管理员操作日志和相应 Outbox 同事务；审核人、原因及 before/after 快照仍保留，普通作者操作不会新增未经契约定义的管理员审计。

只有 Prisma P2034（数据库确认回滚的串行化/死锁冲突）会整体重试，最多三次；重试耗尽映射 409，其他错误原样上抛。回调内只允许数据库操作，不调用对象存储、Kafka publish 或模型等不可回滚副作用。Outbox dispatcher 仍在事务提交后独立投递，保持 at-least-once 与 Inbox 幂等，不宣称 exactly-once。

公开 reader 保留 published/未删除、正文不区分大小写搜索与稳定游标，独立评论分页只返回 visible/未删除记录。评论父级公开检查、列表和计数在同一 RepeatableRead 快照；管理评论父级检查及分页、管理动态列表/计数亦用 RepeatableRead。公开详情只签发 ready 图片的 900 秒 URL，过滤非 ready 图片产生的 null，保持 `imageUrls: string[]` 契约。管理 reader 不对公开查询复用其包含审核信息的投影。

`test/architecture/community-boundaries.spec.ts` 使用 TypeScript AST 检查社区生产 Domain/Application 的静态/类型/动态导入，不允许重新引入外层依赖。该门禁当前只覆盖 Community，其他上下文的 DDD 反向依赖仍需逐一审计，不能据此宣称全后端已满足分层。

单测分为纯领域规则、应用端口编排和 Prisma 适配器参数/事务断言；原社区应用层 Prisma 替身测试已移至 Infrastructure。HTTP e2e 仍用应用服务替身。`test/community.db-spec.ts` 新增四个真实 PostgreSQL 验收：图片顺序/所有权/Outbox、失败回滚、审核审计原子性与失败回滚、并发点赞唯一性和软删除。随既有 `pnpm test:db` 纳入 CI；仅可在显式配置、已迁移的专用测试数据库运行，清理按本测试创建的 ID 限定。本机 Docker engine 管道不可用，因此这些数据库测试尚未执行，事务并发效果仍需真实验证。

执行 `pnpm check`、`pnpm test:e2e`、`pnpm openapi:generate`；导出的契约 SHA-256 应保持 `ddba85ceb39c120d34a971112705133d8b30979de8d97b0ee4e16ef6be5f6a0c`。跨上下文 Asset/雪场引用目前仍由 Prisma 事务适配器读取同库表，尚未提取其他模块的公开校验端口。D-36/D-37 等业务契约确认不在本次结构调整内。
