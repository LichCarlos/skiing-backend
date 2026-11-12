# 字典与权限目录的事务内授权

2026-10-31。负责人：后端负责人。基线为现有 API-M09 与 API-M04；不新增 HTTP 协议、依赖或数据库迁移，OpenAPI 保持 1.44.0。

## 实现与权限语义

字典原仓储只查询审计账号是否存在，权限目录原仓储亦如此。HTTP Guard 的当前授权检查继续保留；现在两条写入链路在 Serializable 事务开始后、业务查询与变更前，通过 `readManagementWriteActor` 读取有效账号、角色关联/状态、活动权限和范围。该 Infrastructure 辅助函数只接受调用方事务，复用现有 Principal reader、Principal 解析和管理入口/范围解析规则，返回审计账号快照。

| 写命令 | 事务要求 |
| --- | --- |
| 字典类型/项创建 | 管理入口 + `system:dict:create` |
| 字典类型/项编辑，含 PATCH 状态 | 管理入口 + `system:dict:update` |
| 字典类型/项 DELETE 软停用 | 管理入口 + `system:dict:delete` |
| 权限目录创建 | 管理入口 + `system:permission:create` |
| 权限目录编辑，含 PATCH 状态 | 管理入口 + `system:permission:update` |
| 权限目录 DELETE 软停用 | 管理入口 + `system:permission:delete` |
| API 权限注册表同步 | 管理入口 + `system:permission:update` + 受保护系统管理员身份 |

字典项的审计键仍为 `system:dict:item:*`，入口与事务的动作授权键均为 `system:dict:*`，与原契约一致。没有把审计键误作新权限，也没有为 PATCH 的状态变更改用 DELETE 权限。

自定义角色仍可管理获授字典与目录元数据。账号/角色停用、角色解绑、入口或动作撤权、多角色动作范围冲突，以及系统管理员混绑其他活动角色时，事务拒绝。没有新增字典/权限节点的行级范围规则，也没有把字典公开标记改为管理员独占权限。

同步额外核实账号仍关联活动角色，且角色同时具有 `RoleKey=system_admin` 与 `SystemRoleCode=system_admin`。仅拥有普通更新 grant 的角色无法调用同步。控制器提前检查保留，事务检查覆盖管理员身份在入口检查后被移除的情况。

领域错误 `ManagementWriteAuthorizationError` 不依赖 NestJS。字典 Application 映射为 403；权限目录沿用其现有仓储错误适配方式，将授权错误映射为 403。配置、OperationLog 和已有字典子树 Outbox 仍为同一事务；拒绝不会留下任何部分提交。

## 并发边界与测试证据

授权来自写事务快照，拒绝在该快照建立前已提交的撤权；不宣称中断快照建立后所有并发撤权。没有新增授权行悲观锁或自动重试。序列化冲突仍返回 409，客户端重新读取再提交。

`test/configuration-write-authorization.db-spec.ts` 在真实 PostgreSQL 中执行 Application 与 Repository：九类委派写入及原子副作用、九类入口成功后撤权、两个模块各六种失效授权，以及普通更新角色/已失去管理员身份的同步拒绝。拒绝前后比较字典、项、完整权限目录、审计和 Outbox 快照；授权写入核对日志及类型/父项变化的子树事件数。没有 Mock Prisma、放宽数据库约束或调用真实 Kafka/provider。

原 `managed-dictionaries.db-spec.ts` 与 `permission-catalog.db-spec.ts` 保留真实 HTTP、层级/引用校验、审计/Outbox 实际失败回滚、并发一致性及管理员同步验证。应用层新增授权错误 403 单测；原仓储单测夹具补齐真实 Principal 读取所需结构。

首轮专项 103/104 通过；一项在重复构造字典夹具时触发 Prisma 默认 5 秒交互事务超时，当时三端检查/编译并行。新套件改为直接插入本套件拥有的合法初始字典树与目录行，目标写操作仍完整执行生产 Application/Repository 的真实事务；原 HTTP 生命周期套件继续覆盖初始化业务流程。保留生产事务超时、Serializable 隔离和数据库约束；首轮失败日志保留，复验与完整回归另行记录。

复验在独立冻结安装后运行本仓 `pnpm check`、`pnpm test:e2e`、专用验证库的 `pnpm db:verify` / `pnpm test:db` 和 `pnpm build`；Web/App 各自独立检查及构建/导出。结果记录在各仓 README 与中央测试现状。日志前缀为 `configuration-auth-`，App 导出目录为 `dist-configuration-auth-validation/`，均保留。

客户端业务和 DTO/VO 不变。浏览器/设备、真实 broker/provider、性能与全项目交付验收仍待完成。

## 最终实际结果

三仓独立冻结安装通过；Backend lint/typecheck、118 文件/853 单测、3 文件/88 HTTP、28 文件/598 真实数据库测试及 build 通过。新增事务授权 32 项，连同原字典 43 项和权限目录 29 项合计 104 项专项通过；全量数据库运行 333.32 秒。初轮夹具超时及复验日志分别保留，未改动生产事务超时或隔离级别。

测试前后 `db:verify` 通过，仍为 20 个迁移。验证使用既有专用容器 `linji-events-validation-20261030`（127.0.0.1:53240），未新建、停止或移除容器。结束后仅剩原管理员，动态/评论/操作日志为 0；本套件账号、字典类型、权限节点均无残留。原 `project_doc.changed.v1` / AggregateId 32 的待处理 Outbox 保留。

Web 完整 check 422 项、官网/Admin 构建通过；App check 183 项、Doctor 20/20 和 iOS/Android/Web 导出通过。三仓 OpenAPI 1.44.0 的 SHA-256 为 `98baf03cc01588729adc9581fce4980a7eca8855b91e03fc37a9aa8a51d99cc2`。客户端业务及生成类型不变；原官网/Admin 开发进程保留。未提交、推送或部署，项目整体未完成。
