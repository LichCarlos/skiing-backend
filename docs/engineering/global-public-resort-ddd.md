# 全局雪场管理与公开查询的 DDD 分层

2026-10-31 阶段最终验证：独立冻结安装、lint/typecheck、118 文件/833 单测、3 文件/87 HTTP、26 文件/499 真实数据库测试及 build 均通过；公开查询专项为 23 项真实 HTTP/PostgreSQL 测试，前后 db:verify 通过，仍为 20 迁移。三仓契约快照均为 OpenAPI 1.41.0、SHA-256 `6708699df73b08b2dc97653abb886f5af2c3acc8b746430cd95ecc8357d13c6a`，无新增依赖或迁移。性能、真实页面成功流程和设备验收仍未完成。

> 2026-10-31 公开查询增量：原 5 项数据库查询扩至 23 项，新增真实 HTTP→DTO→Application→Prisma/SQL 的组合筛选、重复标签、total/稳定分页、非法条件、未公开详情与正 int4 边界。公开详情在仓储前拒绝越界 ID，避免 ORM 500；Swagger 的 page/pageSize 改为明确数字类型，OpenAPI 1.41.0，运行时分页协议保持不变。官网/App 已接地区、价格、评分、营业状态、成对坐标与排序筛选；标签目录精确方案待确认。成功数据态浏览器、原生设备与性能仍未验收。下文旧版本/数字为历史记录。

> 2026-10-30 当前增量：五类写命令已在 Serializable 事务内重新解析主体、动作/入口权限及 resort all 范围；图片 MIME、商家/图片/标签共享锁及 ID 边界已补齐。新增真实 HTTP/PostgreSQL 27 项通过。字段策略与全局资源授权仍有缺口；最新保证与验证见 [全局雪场事务授权](admin-resort-transaction-authorization.md)。下文为原阶段记录。

> 2026-10-29 后续数据库复验：全局雪场真实 PostgreSQL 3 项与公开查询 5 项已通过，含审计回滚、筛选/距离与稳定分页。 19 个迁移、两次 seed 和结构复验亦通过。下文旧“未跑”描述保留为当时阶段记录，当前验证范围以 [数据库验收](database-validation.md) 为准。

实施日期：2026-10-29。负责人：后端接口负责人。代码与替身测试已验证；真实 PostgreSQL、性能和页面/API 联调待验。

## 分层与装配

| 层               | 文件                                                                                    | 职责                                                                        |
| ---------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Presentation     | `presentation/http/admin-resorts.controller.ts`、`public-resorts.controller.ts`、DTO/VO | 请求协议、Guard 主体/范围、参数验证及响应声明                               |
| Application      | `application/admin-resort-service.ts`、`public-resort-service.ts`                       | 全局范围复核、输入/字段校验、生命周期与事务命令编排、公开字段投影和签名 URL |
| Application 端口 | `application/ports/admin-resort-repository.ts`、`public-resort-reader.ts`、对应 models  | 持久化无关的事务能力、分页和记录；精确坐标/评分/Asset ID 不暴露 ORM 类型    |
| Domain           | `domain/resort-lifecycle.ts`、`public-resort-query.ts`、已有范围/字段规则               | 纯 TypeScript 的状态转换、参数与排序白名单、数据范围判定                    |
| Infrastructure   | `infrastructure/prisma-admin-resort.repository.ts`、`prisma-public-resort.reader.ts`    | Prisma/SQL、数据库映射、快照、事务、引用复核、Outbox 和审计                 |
| 装配             | `resort-management.module.ts`                                                           | 将 `ADMIN_RESORT_REPOSITORY`、`PUBLIC_RESORT_READER` 绑定实际适配器         |

连同已拆分的商家/收益用例，ResortManagement 全部 Application 生产代码不再导入 Prisma、Infrastructure 或 HTTP DTO；Domain 不依赖 Nest/Prisma。应用层保留 Nest DI/HTTP 异常适配，跨上下文只通过应用端口和明确的领域规则协作。AST 门禁覆盖该上下文全部生产 Application/Domain，尚未把全平台其他上下文标为完成。

## 全局写入

七类入口仍必须有服务端解析的 `resort.kind=all`；缺失及 self/merchant/selected 一律 403。动作权限和 portal 门禁独立生效，不按商家等业务角色名分支。商家 self/selected 继续执行 [D-38 规则](merchant-resort-scope.md)，不获得全局权限。

写入在一个 Serializable 事务内检查有效商家及其 active 账号、图片 ready、标签和字典类型 active；管理员可引用任意已 ready 的图片，商家接口仍限制 owner。业务字段、相册/标签关系、Outbox、OperationLog 在该事务内保存。更新使用读取版本 `updatedAt` 作为条件，丢失更新及 P2034 返回 409，不自动重试旧预读。签名 URL 在事务成功后生成。

管理员编辑已发布雪场保持 published；发布仅允许 draft/pending_review/offline，下架仅允许 published，DELETE 仍软删除。管理员与商家审核流分别沿用既有契约。字段 schema/完整 RBAC 仍在请求期读取，尚未增加写事务内的完整撤权和 schema 快照复核。

全局表格的列表/count 在同一个 RepeatableRead 快照内执行，保持更新时间、ID 倒序分页。

## 公开筛选和数据库分页

原公开列表先取回全部匹配雪场，在应用内计算距离、排序和切页。现在参数化 SQL 在数据库筛选、计算距离、稳定排序和 LIMIT/OFFSET；之后只加载当页 ID 的实体关系与当前用户收藏，按 SQL 顺序投影。count、页 ID、当页详情和收藏在一个 RepeatableRead 快照内读取。空页仍返回总数；游客不查询收藏。

- 查询仅包含 published 且未软删除记录；每个所选标签各有一个 EXISTS，并要求标签及字典类型 active，保持“全部命中”。
- 关键词以不区分大小写的字面子串匹配名称和地区；引号、百分号和 SQL 片段都作为绑定值处理。
- 仅允许 name/price/rating/distance 排序及 asc/desc；标识符和方向只从服务端常量 SQL 片段选择。相同排序值按 ResortId 升序；空评分/距离放最后。
- 距离采用 Haversine 公式、地球半径 6371000 米并取整，计算中间值限制在 0..1；坐标必须成对，distance 排序必须提供坐标。缺少雪场坐标时距离为 null。
- 公开动态字段继续由 Application 按活动 schema 和 `IsPublic=true` 过滤，不返回管理字段或商家归属。图片仍签发 900 秒读取 URL。

数据库分页减少应用进程的全量加载，但距离排序仍可能扫描并计算全部匹配记录；尚无 EXPLAIN/大数据集压测，不宣称已满足规模化性能目标。后续根据实测决定空间索引或其他优化。

本轮未新增 HTTP 字段/路由、数据库模型/migration 或依赖。OpenAPI 仍为 1.28.0，SHA-256 `61ede5b5214de4f47c1631b12ce5735384fed0fe1c26ac8d3a4c1f43db7c0c4e`。

## 测试证据与限制

- Application 测试覆盖 published 编辑、事务引用失败/审计失败不签名、状态拒绝；Infrastructure 测试覆盖范围前置拒绝、版本冲突、Serializable/P2034、ready/active 引用校验、Outbox/审计编排。
- 公开读取替身测试检查 SQL 值绑定、全部标签、LIMIT/OFFSET、当页 hydration、稳定返回顺序、快照及收藏隔离；Domain 测试检查越界输入和排序白名单。
- Backend `pnpm check`：94 文件/475 项通过，HTTP e2e：2 文件/63 项通过；build/OpenAPI 导出与 Web/App 契约校验通过。HTTP 使用服务替身，不等同真实数据库或页面验收。
- 三仓独立 frozen install 通过；Web 全量 check（64 项及格式）与官网/Admin production build 通过；App check（9 文件/64 项、Doctor 20/20）与 iOS/Android/Web export 通过。前端业务代码、依赖和 migration 未变更。
- `test/public-resort-query.db-spec.ts` 新增 5 项 PostgreSQL 验收，覆盖实际距离 SQL/排序、标签、分页/count、字面关键词和公开详情；`test/admin-resort-scope.db-spec.ts` 现有流程外增加审计失败时业务/Outbox 回滚，共 3 项。均纳入既有 test:db/CI 自动发现，并通过 lint/typecheck。
- 本机既有 Docker/数据库故障未解决，这 8 项数据库测试尚未执行，远程 CI 也未运行。替身测试不能证明 SQL 在 PostgreSQL 可执行、事务回滚或真实并发安全。Kafka、对象存储/provider、浏览器/设备/API 成功流程仍未验收。
