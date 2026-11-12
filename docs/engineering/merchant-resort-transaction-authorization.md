# 商家雪场事务授权、字段快照与引用一致性

日期：2026-10-30。对应 API-R02、D-38 与已确认的 MerchantResortVO/动态字段规则。状态：代码与专项真实数据库测试通过；完整阶段检查以 README 最新记录为准。本阶段没有新增 HTTP 路由、业务字段、依赖或 migration，OpenAPI 保持 1.39.0。

## 变化与保证

创建、编辑、软删除、提交审核四个命令，现均通过 `MerchantResortTransaction.authorize` 在各自 Serializable 事务内重新解析当前账号、有效角色、动作权限、管理入口及 `resort` 数据范围。重新解析的范围必须与本次请求已取得的范围一致；发生变化或多角色冲突返回 403，由客户端重新加载授权，而不继续使用旧的范围。相同 selected 集合不受 ID 顺序影响。

授权仍通过数据库 grants 组合。商家是业务层 MerchantProfile 归属，不要求固定商家 RoleKey。all 在商家路由仍只管理本人名下雪场；selected 仍与本人归属取交集，且不能创建雪场。账号有效、商家资料有效及资料归属均须匹配；合法当前范围下的跨商家、未选中或不存在目标依然 404。

对本人的 MerchantProfile 领取共享行锁后，再验证当前有效资料与账号快照；创建时从可信上下文设置 MerchantId。更新保留 UpdateTime 乐观条件，防止事务外预读的雪场或合并内容覆盖已提交的新版本。软删除在事务内读目标；所有命令仍将业务数据、相册/标签关系、Outbox 和 OperationLog 原子提交。

创建/编辑的动态字段校验已移入同一写事务。`merchantFieldContext` 读取活动分组中的活动定义、当前有效角色的 CanRead/CanWrite 并集、活动字典类型下的活动选项，并复用纯领域 `validateCustomFieldWrite`。字段停用、分组停用、授权撤销或校验规则变更若已在当前事务快照之前提交，会影响本次写入。未知或无写权限的提交字段为 422；省略字段保留已有值，包括不可见历史字段。不会因本人具有商家 all 范围就跳过字段权限。

业务 Application 仅通过类型化事务端口获取上述上下文，不依赖 Prisma/基础设施。纯领域规则继续与 NestJS、数据库和 HTTP 隔离。签名图片 URL 在写事务成功后生成，不在持锁期间请求对象存储；响应字段仍按活动定义和读取时的有效字段策略投影。

## 引用与输入边界

图片绑定前按 AssetId 排序领取 `FOR SHARE`，再核对本人所有、ready 及 JPEG/PNG/WebP MIME；封面和相册复用同一去重集合。标签绑定前依次锁定 `resort.fit_tag` 类型及按 ItemId 排序的相关字典项，再检查类型/字典项 active。关系写入前的状态核对与关系提交共用同一事务，引用在此期间不能被并发停用或删除后仍按旧状态绑定。

若停用/修改方先持锁，写入方等待后因 Serializable 快照过期收到 PostgreSQL 40001，或发生 40P01/P2034，统一返回 409。保持“重读后再决定重试”，不自动重放已经合并的旧表单。不存在或已失效的引用在普通请求中仍为 422。

资源 ID 使用正 PostgreSQL int4；偏移分页必须是安全整数且 skip 不超过 int4。图片 ID 在应用层验证为规范正十进制字符串且不超过 bigint 上限，不先转换为 JavaScript number；0、负数、前导零别名及溢出字符串不会进入引用 SQL。真实库验证这些输入得到 400/422，无写入或内部 SQL 错误泄漏。

## 实测证据与失败修复

新增 `test/merchant-resort-http.db-spec.ts`，装配真实 Nest、DTO、认证、bcrypt、JWT、Guard、应用服务、Prisma、Outbox 与 PostgreSQL；仅对外部对象存储读取 URL 使用固定适配器。旧 `merchant-resort-scope.db-spec.ts` 现建立独立角色与真实 grants，selected 写入测试也保存对应的真实 RoleDataScope，不把直接传入的测试 scope 当作数据库授权。不会改动共享内置角色权限。

首轮 10 项中 9 项业务回归失败：四个动作在 Guard 后撤权仍写入成功、selected 收窄后仍创建成功、字段写权限/字段/分组/校验规则变化后仍写入。通过仓储 runWrite 的一次性调度钩子，在真实 Guard 成功之后提交变更，再执行原始真实仓储和事务，复现了旧快照的问题；没有替换数据库权限解析或业务写入。修复后扩充至新文件 29 项，连同原 4 项范围测试，专项 33 项通过。

新增覆盖：六种主体/入口/角色/资料/冲突变化、字段读写并集与私密历史字段保留、未知字段拒绝、动态选项类型/字典项停用、跨商家命令、完整生命周期四个事件与四条审计、图片 owner/ready/MIME、bigint/分页输入边界，以及真实审计 INSERT 失败后雪场、相册和 Outbox 全部回滚。

引用竞争测试在真实事务中先修改资产/字典项并持锁，再发 HTTP 更新；通过 `pg_stat_activity` 确认 `FOR SHARE` 等待，释放后验证 409 且业务、关系、审计和事件都无副作用。不是根据固定等待时间推测竞争已经发生。对应单测补充 raw 40001/40P01 映射及数据库 ID/分页边界，原业务端口与架构边界测试继续保留。

测试夹具曾因缺少 DictionaryType.GroupKey、未按外键顺序删除字段与角色策略而失败，已修复，不放宽数据库约束。失败遗留仅按本轮精确随机 fixture 前缀核查并清理；不批量删除历史业务或其他测试数据。

复用经身份核验的专用 `linji-events-validation-20261030`，完整 ID `45a28641a1d2f357f3ce5c088e8f3a876433d34d43d4a8b4f76c0c09ddb7f3a2`，loopback 53240，pgvector/pgvector:pg17；20 个迁移。未写 `.env` 或迁移开发数据库，未停止验证容器及用户开发服务。

## 实际边界

本阶段完整验收：三仓分别 `pnpm install --frozen-lockfile` 通过；Backend `pnpm check`（117 文件/789 单测）、`pnpm test:e2e`（3 文件/85 项）、`pnpm test:db`（24 文件/410 项）与 `pnpm build` 通过，完整数据库测试前后 `pnpm db:verify` 均通过。Web `pnpm check`（187 项）和官网/Admin production build 通过；App `pnpm check`（99 项、Doctor 20/20）与三平台导出通过。三仓 OpenAPI 1.39.0 SHA-256 均为 `bd9f3a624ab2263966bc4e9b6a33bd677e735af94f27ff44b446b2ba5a9e9444`。未新增依赖、HTTP schema 或 migration，未提交/推送/发布。用户原 3010/3001 开发进程保持不变，专用验证容器与 App 导出目录保留。

授权与字段定义仍遵守事务快照语义：不保证在授权读取之后发生的撤权立即取消所有在途请求。共享引用锁协调本次引用提交，不阻止业务允许的后续停用；公开查询与 RAG 仍须按读取时的来源规则过滤。查询列表、详情、字段目录仍采用原有请求 Guard 与数据过滤，本轮不宣称它们已改为统一事务授权快照。

本段为2026-10-30阶段边界：当时真实存储、浏览器、生产恢复/负载及其他模块授权仍需单独审计；本阶段没有擅自新增管理API。RAG来源运维后续已获确认并实施，现行协议和证据见[AI运维说明](ai-operations.md)；真实私有存储证据见[MinIO验收](minio-source-storage.md)，当前缺口以README最新记录为准。
