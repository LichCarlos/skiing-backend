# 收藏模块 DDD 与公开目标一致性

2026-10-30：D-36 已确认并补齐公开文章 favoriteByMe、本人关系投影和 no-store 响应；写入协议保持 204。新增真实 HTTP/PostgreSQL 验证见 [文章收藏状态](article-favorite-state.md)。

> 2026-10-29 后续数据库复验：收藏真实 PostgreSQL 5 项已通过，涵盖本人隔离、幂等/并发唯一、公开分类、失效取消与分页。 19 个迁移、两次 seed 和结构复验亦通过。下文旧“未跑”描述保留为当时阶段记录，当前验证范围以 [数据库验收](database-validation.md) 为准。

实施日期：2026-10-29。负责人：后端接口负责人。状态：业务实现与自动化验证已落地，真实 PostgreSQL/设备 API 验收待完成。

## 分层与协议

`MemberFavoritesService` 通过 `FAVORITE_REPOSITORY` 使用业务端口，只负责领域校验、不可收藏目标到 404 的映射、分页及响应投影。`domain/favorite-rules.ts` 是纯 TypeScript：限制 resort/article、数据库正整数 ID 和安全分页偏移；非法 ID/类型/分页在访问持久化前返回 400。`PrismaFavoriteRepository` 负责 ORM、BigInt/Decimal 映射、公开目标筛选、事务和唯一键冲突适配。Module 负责端口绑定；Controller 继续仅从服务端请求上下文取得账号。

没有新增路由、HTTP 字段、依赖、数据库字段或 migration。API-F01 继续使用 PUT/DELETE 幂等命令、本人偏移分页和既有 FavoritePageVO。收藏 ID 保持字符串；时间由应用层输出 ISO；雪场价格保留字符串，评分允许 null。不会返回文章正文、动态字段或商家私有数据。生产 Application/Domain 的依赖由 AST 测试检查，禁止 Prisma、Infrastructure、HTTP DTO 和计算导入进入内层。

## 可见性与一致性

收藏目标必须与公开页面一致：雪场 published 且未软删除；文章还须有 PublishTime，分类属于 `knowledge.article_category`、字典项和类型 active、类型 publiclyReadable。新增收藏与列表使用相同公开条件，修复旧收藏列表仍能展示停用/私有分类及其他字典类别文章摘要的问题。分类不可见后，收藏关系保留，但列表与 total 都隐藏该目标；恢复公开条件后可重新展示。取消收藏不要求目标继续公开，允许用户清理失效关系。

添加收藏时，公开状态复核与 owner+目标 upsert 位于同一个 Serializable 事务，依赖既有 Favorite 互斥约束和 `(UserId, ResortId)` / `(UserId, ArticleId)` 唯一键。重复成功提交保持同一关系及原收藏时间。并发发生 P2034/P2002 时返回 409，客户端可明确重试，不在服务端盲重试，也不将失败报告为成功。这里保证事务串行化语义，不保证提交后目标永不下架；后续列表仍重新应用公开条件。

列表/count 共用 RepeatableRead 快照，owner、类型和公开条件完全相同，先过滤再分页；排序为 CreateTime DESC、FavoriteId DESC。取消收藏是一个带 UserId 的 deleteMany，重复删除仍成功，不能影响其他账号。收藏是本地关系操作，没有额外 Kafka/模型副作用，不添加无消费用途的 Outbox。

## 证据与边界

- 应用端口测试覆盖真实账号参数、目标 404、失效目标取消、非法输入无持久化调用、精确 ID/日期/价格投影以及持久化错误传播。
- Prisma 适配器测试覆盖事务内公开状态复核、分类条件、唯一键、并发错误、owner 删除、列表/count 条件与快照、摘要字段白名单。替身测试不证明实际 PostgreSQL 行为。
- HTTP 测试现在装配真实收藏应用服务，仅替换仓储端口；覆盖身份与权限、DTO、公开目标 404、owner 参数、分页响应、非法删除 ID/类型及越界 offset。其他业务 HTTP 测试仍有服务替身。
- `test/member-favorites.db-spec.ts` 新增 5 项专用已迁移 PostgreSQL 验收，覆盖重复/并发添加、本人隔离、失效目标移除、分类停用/私有/错误类型隔离、分页/count 与同时间排序，已纳入既有 test:db/CI 自动发现。测试会创建唯一 fixture 并清理；分类类型测试仅允许在专用测试库运行，并在 finally 恢复类型状态。

本阶段 Backend frozen install、check（103 文件/540 项）、HTTP e2e（2 文件/70 项）、build/OpenAPI 导出与变更 TS 格式检查通过，最终 lint 无警告。Web 独立 frozen install、check（64 项）与官网/Admin production build 通过；App 独立 frozen install、check（9 文件/64 项、Doctor 20/20）及三平台 export 通过。三仓 OpenAPI 仍为 1.28.0，SHA-256 `61ede5b5214de4f47c1631b12ce5735384fed0fe1c26ac8d3a4c1f43db7c0c4e`；没有前端业务代码变更。

真实数据库测试尚未执行：本次复查 Docker Linux engine 管道仍不存在，未发现可用 psql/PostgreSQL 安装；远程 CI 未运行。公开分类规则需要持续与 API-K01 保持一致；组件/设备/API 成功流程、并发撤权及真实数据库事务仍需验收。D-36 文章收藏状态 VO 缺口保留，未擅自增加协议字段。
