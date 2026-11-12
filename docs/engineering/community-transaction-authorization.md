# 社区事务内授权与引用并发

本阶段最终验证（社区事务授权）：三仓独立 frozen install 通过；Backend lint/typecheck、115 文件/734 单测、3 文件/84 HTTP、21 文件/329 真实数据库测试、build/OpenAPI 通过，测试前后 db:verify 均通过（20 迁移）。Web 完整 check 175 项及官网/Admin production build；App check 96 项、Doctor 20/20、iOS/Android/Web export 均通过。无新依赖或 migration，OpenAPI 仍 1.38.0、三仓 SHA-256 均为 `675969590facea86c8228c2e89fc8a69ee0329f893ab0e4314ad8c1fe6fcbc6e`。未提交或推送，原 3010/3001 开发进程保持不变。

2026-10-30；在 OpenAPI 1.38.0 的既有接口上修复授权和引用事务边界。未新增 HTTP 路由/字段、依赖或 migration；三仓快照和生成类型不需要变化。

## 事务内权限

此前 CommunityWrites 与 AdminCommunityService 只依赖 HTTP Guard。调用应用服务的后台任务或测试可以绕过 Guard，请求放行后、写事务开始前的撤权也未必被用例发现。

CommunityTransaction 增加 authorize 端口。全部 11 种写命令在读取业务数据前调用；Prisma 适配器使用当前事务中的 PrismaAuthorizationPrincipalReader 和既有 ResolveAuthorizationPrincipal/resolveDataScope，重新读取账号、商家资料、有效角色、权限状态和范围。不存在/停用账号、停用角色、权限撤销、多角色范围冲突和混合 system_admin 均按共享 RBAC 规则拒绝，不依赖旧 JWT 的权限快照。

| 写命令                  | 事务内要求                                         |
| ----------------------- | -------------------------------------------------- |
| 创建动态                | community:dynamic:create                           |
| 修改、删除本人动态      | community:dynamic:update-own，随后仍校验作者归属   |
| 新增、删除本人评论      | community:comment:create，删除仍校验作者归属       |
| 点赞、取消点赞          | community:like:toggle                              |
| 动态/评论审核与管理删除 | content:dynamic:moderate + management:portal:enter |

社区没有已定版的独立 resource scope：继续按 Guard 的 permission-key fallback 解析有效范围，不添加 community 目录项或擅改 ownership 语义。管理员权限仍来自角色授权；只有 roleKey 名称而没有 grants 不会绕过检查。管理列表/详情的读授权仍由现有 Guard 负责。

事务内复核使用 Serializable 的授权快照。若撤权在事务授权读取前已提交，则拒绝写入；若撤权发生在授权快照之后，本阶段不承诺即时取消正在执行的事务。未为整套权限管理建立统一锁协议或验证全系统授权竞争，不能称为全域并发撤权完成。

## 引用锁

动态创建/编辑校验图片前，按 AssetId 数值升序执行 FOR SHARE，持锁至事务结束。随后读取并确认 owner、ready、JPEG/PNG/WebP；多图原始展示顺序不变。共享锁允许多个有效引用并存，并与 Asset 删除仓储已有的 FOR UPDATE 协调。删除方等待后会重新查询引用，避免先检查无引用、后误删刚绑定图片。

雪场引用校验同样对目标 SkiResort 加 FOR SHARE，再检查 published 且未删除。雪场修改先提交时，引用方重新检查并拒绝；引用先提交后，雪场仍可按业务流程修改，既有动态关联不代表雪场必须永久保持公开。

Serializable 的等待可能产生 Prisma P2034，raw SQL 也可能返回 P2010 + PostgreSQL 40001/40P01。这些确认已回滚的冲突整体重试，最多三次；每次都重新授权及校验引用。其他 raw SQL 错误不重试，耗尽仍 409；不把任意数据库错误当作可重试。事务中不调用外部存储、Kafka publish 或模型。

## 验证证据

社区单测 11 文件/123 项通过，包括新增的当前授权拒绝、全部应用写路径、raw 行锁错误分类。真实 PostgreSQL 专项为 `community-http.db-spec.ts` 48 项与 `community.db-spec.ts` 5 项，共 53 项。

- 真实应用服务直接调用全部 11 个写命令，无有效 grants 时拒绝，动态/评论/点赞/Outbox/审计不变。
- 真实 HTTP Guard 放行后，测试只在进入 UnitOfWork 前插入调度门：分别撤销 grant、移除角色绑定、停用账号、停用角色、新增冲突角色，随后启动真实事务，全部 403；管理审核分别移除入口或审核 grant 亦 403，无成功审计/事件。
- 用真实 UnitOfWork 在图片校验后、INSERT 前暂停，保持共享锁；owner/admin 的真实 HTTP 删除均由 pg_stat_activity 确认等待，引用提交后删除返回 422，图片 ready、关联/事件完整。
- 反向顺序：数据库事务先更新图片为 deleted 并持排他锁，HTTP 创建等待后，释放锁并提交删除；最终 404，无动态/图片关联。雪场先撤回再提交也使等待中的引用返回 404。

这些调度门仅延迟真实用例，不替换认证、授权、事务或业务持久化。外部 AssetStorage 仍是签名替身；真实 MinIO/S3、浏览器/设备、全域授权协议和生产负载仍待验。完整三仓结果见各仓 README 与交付记录；此前输入边界阶段的证据见 [社区验收](community-validation.md)。
