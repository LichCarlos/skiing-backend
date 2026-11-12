# 账号管理写事务授权

日期：2026-10-31。负责人：Backend 身份权限模块负责人。范围：API-M02 的创建账号、PUT 全量替换角色、PATCH 状态与 DELETE 软停用。沿用 OpenAPI 1.44.0；不增加接口、依赖或数据库迁移。

## 问题与处理

原 Guard 已解析入口、动作与 user 范围，但 Repository 使用请求进入时的 scope 和 actorIsSystemAdmin，事务只查审计账号。若入口读取后、写事务快照建立前已提交撤权、角色解绑或范围收窄，旧授权仍可能完成写入。

三个写入用例及仓储端口已删除这两个授权快照参数。HTTP 层仍作前置校验；写事务使用 `audit.actorUserId`，由 `user-write-authorization.ts` 调用同一 TransactionClient 上的 Principal Reader、Resolve 用例和领域授权函数。账号、角色、权限必须有效，必须有管理入口、对应动作及不冲突的 user 范围。

真实数据库回归还发现原详情/写入查询将 `{ UserId: target, ...scopeWhere(scope) }` 直接展开。self 的 UserId 或 selected 的 ID 条件覆盖了目标编号，导致查到范围内其他账号后仍按原目标编号执行写入。详情、角色替换和状态查询现统一使用 `AND: [{ UserId: target }, scopeWhere(scope)]`，目标 ID 和数据范围都必须匹配；列表与总数继续使用同一 scope 过滤。新增读取回归覆盖 self/selected 的正确目标、不可见目标和列表总数。

- 创建：`system:user:create`，最新范围须为 all；空 roleIds 仍使用受保护 registered_user 基础角色。
- 全量替换角色：`system:user:assign-role`，先按最新范围查目标，再删除和重建 UserRole。省略的关联按原 PUT 语义移除，空数组允许；目标不可见返回 404。
- 启停及 DELETE：`system:user:update`，使用相同的最新范围查询目标；DELETE 仍复用软停用用例。
- self 限当前账号；selected 限当前 ID 集合；merchant 沿用当前商家资料关联规则；all 全部。商家身份不依赖 RoleKey。
- 授予 system_admin 另查询活动角色的 RoleKey 和受保护 SystemRoleCode，两者均为 system_admin 才可授予。自定义角色持有管理动作也不能替代此身份。混合管理员与其他活动角色继续拒绝。

授权失败转 403；不可见目标 404；非法账号/角色编号 400；P2034 序列化冲突转 409，要求重新读取后再提交，不自动重试写入。用户编号及角色数组在进入 Repository 前校验正 int4、唯一性；用户列表偏移也限制在 int4 范围内。写入时发现 user selected 范围包含越界编号则拒绝授权，避免触发 Prisma int4 查询错误；其他资源范围的编号边界仍需分别审计。密码继续按 8–72 UTF-8 字节校验，仅散列值进入持久层，响应和审计不含密码与散列。

创建、替换和状态变更使用 Serializable 事务，并保留系统管理员角色行锁与最后一名 active 管理员检查；账号/角色集合和成功审计一起提交或回滚。响应读取不再重新套用已授权前的旧 scope，避免本人更改角色后的商家关联条件干扰同一事务结果。

## 授权时间边界

授权依据为写事务的数据库快照，第一条 SQL 是管理员角色锁查询。保证拒绝快照建立前已经提交的撤权；不保证即时取消快照建立后的所有撤权或锁等待期间的授权变更。本阶段没有增加授权行悲观锁、跨请求幂等或并发版本协议。

## 测试与限制

`application/manage-users.spec.ts` 验证不再传递快照、输入在哈希/仓储之前被拒绝、403/404/409 映射及无自动重试。`test/user-write-authorization.db-spec.ts` 使用真实 Application、Prisma 和 PostgreSQL，先读取入口授权，再在独立提交中撤权，验证三类事务重新校验。

专项覆盖有效委派、自定义角色、账号/角色停用、解绑、动作/入口撤销或停用、冲突范围、收窄后的不可见目标、当前 self/selected/merchant 范围、管理员授予与混合身份拒绝、默认注册角色、密码验证及真实审计 INSERT 失败回滚。拒绝用例比较本套件账号/角色关联与完整审计快照。

夹具以随机前缀创建并清理，临时停用的权限项在 afterEach 恢复；不修改 seed 管理员或受保护角色定义。既有 `identity-sessions.db-spec.ts` 覆盖真实 HTTP 管理员创建账号、自助改密和三个最后管理员锁竞争。新套件未暂停真实 HTTP Guard 在途请求，不把入口读取模拟说成浏览器或全链路即时撤权验证。

日志前缀 `user-auth-`，App 导出为 `dist-user-auth-validation/`。本阶段 Web/App 业务未改；账号管理 UI 的角色目录分页、编辑与重复提交流程仍需后续完善，浏览器/设备/供应商、全局工作台和 AI 运维/审计仍有缺口。最终验证结果以公共追踪矩阵和各仓 README 为准；项目整体未完成。

初轮命令 `pnpm test:db -- <files>` 实际执行了完整 30 文件/688 项，其中 682 通过、6 项失败；四项揭示上述目标条件覆盖，两项涉及新范围边界检查。失败日志 `user-auth-db-target.log` 保留。之后的定向复验通过 `pnpm exec vitest run --config ./vitest.config.database.ts <files>` 显式传递文件过滤条件；不把最初的命令名称当作实际执行范围。

## 最终结果

新账号真实数据库专项 51 项与原认证会话 12 项合计 2 文件/63 项全部通过。稳定源码上的完整数据库回归为 30 文件/690 项全部通过，耗时 349 秒；前后 db:verify 通过，保持 20 个迁移。初轮失败、专项复验、完整复验分别保留在 `user-auth-db-target.log`、`user-auth-db-recheck.log`、`user-auth-db-full-final.log`。

Backend 完整 lint/typecheck、119 文件/873 单测、3 文件/88 HTTP 及 build/OpenAPI 导出通过。三仓独立冻结安装通过；Web check 579 项及官网/Admin 构建通过；App check 183 项、Doctor 20/20 与 iOS/Android/Web 导出通过。OpenAPI 1.44.0 三仓 SHA-256 均为 `98baf03cc01588729adc9581fce4980a7eca8855b91e03fc37a9aa8a51d99cc2`。

结束后仅原 active 管理员，动态/评论/操作日志均为 0；四项临时测试权限均恢复 active，既有 pending Outbox 事件、验证容器和 3010/3001 原开发进程保留。夹具无残留，未提交、推送或部署。本阶段没有增加浏览器成功交互、真实设备或真实供应商验收证据。
