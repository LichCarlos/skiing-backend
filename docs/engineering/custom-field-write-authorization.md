# 字段与分组的事务内写入授权

2026-10-31。落实 API-M10 既有权限规则，无新增接口、DTO/VO 字段、依赖或 migration。OpenAPI 保持 1.44.0。

## 授权与事务

`PrismaCustomFieldRepository` 的七类写命令，在 Serializable 事务内、读取目标或修改配置前，重新读取账号、角色关联、角色状态、活动权限与数据范围。使用现有 `ResolveAuthorizationPrincipal`、`PrismaAuthorizationPrincipalReader`、`mayEnterManagementPortal` 和 `resolveDataScope`，与 HTTP Guard 的管理入口及动作检查保持一致。

| 命令 | 动作权限 |
| --- | --- |
| 创建字段 | `system:field:create` |
| 编辑/启用字段 | `system:field:update` |
| 停用字段 | `system:field:delete` |
| 创建分组 | `system:field-group:create` |
| 编辑分组 | `system:field-group:update` |
| 停用分组 | `system:field-group:delete` |

字段管理保持按权限委派，自定义角色可以执行获授操作，不依赖商家角色键。账号/角色停用、解绑、入口或动作撤权、多角色范围冲突，以及系统管理员混绑活动角色，均拒绝写入。未引入新的字段行级范围语义。

创建或更新显式提交 `isPublic: true` 时，事务额外检查当前账号仍关联活动角色，且该角色同时具备 `RoleKey=system_admin` 与 `SystemRoleCode=system_admin`。控制器的提前检查保留；仓储复核阻止使用旧身份绕过限制。普通获授权角色可提交 `false`，省略公开标记的语义保持不变。

拒绝使用独立领域错误 `CustomFieldAuthorizationError`，Application 映射为 403。配置变更、版本增量和成功审计不会落库；其他版本冲突、真实审计失败回滚与分组引用校验沿用现有规则。读取接口无变化。

## 并发边界

授权读取属于写事务的数据库快照，能够拒绝在该事务取得快照前已经提交的撤权。测试明确复现“入口授权读取成功 → 提交撤权 → 开始仓储事务”，不宣称中断事务快照建立后发生的全部并发撤权，也没有引入账号或授权行的悲观锁。序列化冲突继续返回 409，调用方重新读取后提交。

## 验证入口

- `test/custom-field-authorization.db-spec.ts`：真实 PostgreSQL 上七类委派写入与七类撤权拒绝，入口旧 Principal 保持授权但新事务拒绝；账号/角色/入口/解绑/范围冲突/管理员混绑；公开字段创建与编辑限制、管理员允许及普通角色清除；配置、版本、审计快照与 Outbox 数量核对。测试直接执行 Application/Repository，未伪称为浏览器或 HTTP 在途测试。
- `manage-custom-fields.spec.ts`：事务授权错误映射 403。
- `test/custom-field-audit.db-spec.ts`：保留真实 HTTP 生命周期、引用竞争、版本竞争与六类实际审计 INSERT 失败回滚。

独立冻结安装后运行 `pnpm check`、`pnpm test:e2e`、专用已迁移验证库上的 `pnpm db:verify` / `pnpm test:db`，最后 `pnpm build`。Web/App 独立执行检查与构建/导出；客户端业务和生成契约未改变。完整验收结果记录于本仓 README 和中央测试现状。

## 本阶段实际结果

三仓独立冻结安装通过。Backend lint/typecheck、118 文件/852 单测、3 文件/88 HTTP、27 文件/566 真实数据库测试及 build 全部通过；字段配置/审计专项 26 项与新增事务授权专项 24 项合计 50 项。测试前后 `db:verify` 通过，仍为 20 个迁移。Web 完整 check 422 项及官网/Admin 构建，App check 183 项、Doctor 20/20 与 iOS/Android/Web 导出通过。

OpenAPI 三仓保持 1.44.0，SHA-256 为 `98baf03cc01588729adc9581fce4980a7eca8855b91e03fc37a9aa8a51d99cc2`。保留各仓 `field-write-auth-*.log` 和 App 的 `dist-field-write-auth-validation/`。验证使用既有专用容器 `linji-events-validation-20261030`（127.0.0.1:53240），未创建、停止或删除服务。未提交、推送或部署。

仍未覆盖字段公开性变化触发 RAG 重建/失效的完整闭环、真实浏览器/设备和供应商联调。项目整体尚未完成。
