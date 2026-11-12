# D-48 管理员重置密码

2026-11-02；用户已确认；OpenAPI 1.50.0。独立契约为本仓 `contracts/openapi.json`，不导入 Web/App 代码。无新依赖或数据库迁移。

`PATCH /admin/users/:id/password` 接收 `{newPassword,reason}`，成功 204。密码保留空格并校验 8–72 UTF-8 字节；原因 trim 后 1–500 字；禁止额外属性。现存 disabled、本人和其他管理员均可作为目标，不修改状态/角色，不强制首次改密。新增动作 `system:user:reset-password` 仅进入系统管理员种子模板；已有环境需按本仓 README 执行幂等 seed。

Controller 执行入口、动作和资源范围守卫；Application 校验并哈希密码；Repository 在 Serializable 事务中重读有效操作者、受保护 `SystemRoleCode=system_admin`、管理入口、动作和 user all 范围。目标行锁后更新 hash、撤销目标所有 AuthSession 并写 OperationLog；任一步失败全部回滚。审计只保存原因、操作者快照、目标及撤销数量，不保存密码/哈希。SQLSTATE 40001/40P01 和 Prisma P2034，包括 P2010 包装，映射 409。

登录端口增加 `expectedPasswordHash`，创建会话前按 active + 已验证 hash 条件执行同值 UPDATE，再在同一事务插入会话。这一写入同时锁定并产生新的用户行版本：旧密码校验后才到达的登录被拒绝；若重置事务的 Serializable 快照早于新登录，用户版本变化迫使重置冲突，避免遗漏刚提交的会话。单纯 SELECT FOR UPDATE 无法覆盖后一个快照场景。重置 204 后，后续 access 请求和 refresh 均因会话已撤销被拒绝；不追溯取消已经执行中的请求。

实现位置为 identity-access 的 `domain/password-reset.ts`、`application/reset-managed-password.ts`、repository 端口、Prisma 实现和 `presentation/http/admin-password.controller.ts`。认证旧端口测试替身同步返回 boolean，未放宽登录拒绝规则。

## 验证与复现

本阶段完整 check 130 文件/1039 单测、HTTP 4 文件/126 项、build 通过；全库 34 文件/823 项（新重置 13 项）通过。仅使用本轮新建 pgvector/pg17 容器及 `linji_password_validation`，23 项迁移、双 seed、db:verify 通过。首次全库后 db:verify 缺 INITIAL_ADMIN_ACCOUNT 而退出，补入原模拟 seed 账号后通过，未修改验证逻辑。首次重置断言的 BigInt 序列化及旧 HTTP mock 返回值问题已修正，失败日志保留。

在确认的可销毁库中，按 README 配置环境、部署迁移、执行两次 seed 和 db:verify，再运行 `pnpm test:db`。重置专项为 `pnpm exec vitest run --config vitest.config.database.ts test/admin-password-reset.db-spec.ts`。该测试只接受 loopback 的专用库；GitHub Actions 另要求显式 `LINJI_DATABASE_TEST_DISPOSABLE=true` 和工作流声明的临时 linji_snow 服务库。工作流已补环境声明，远程 CI 尚未执行。

13 项真实 Nest/HTTP/PostgreSQL 测试覆盖密码与会话、本人/disabled、非法 DTO、伪管理员、事务内停用/解绑/范围冲突、审计回滚、旧密码登录和确定性的快照竞争。单测覆盖端口错误映射及未知事务错误传播。不将这些结果等同所有撤权时序或生产故障验收。

## 浏览器夹具

`scripts/password-browser-fixture.ts create|verify|cleanup` 独立管理模拟账号。仅允许 loopback 专用库，且 `PASSWORD_BROWSER_FIXTURE_CONFIRM=linji_password_validation`；create 要求新 seed 后仅一个账号，密码从进程变量 `PASSWORD_BROWSER_FIXTURE_PASSWORD` 读取，清单仅存模拟账号/ID，无凭证。verify 断言目标两次和本人一次成功审计、目标与本人会话全部撤销；cleanup 仅移除清单记录的账号、角色和审计，不碰 seed 账号。

Web 只从环境接收该清单 JSON；不导入后端文件、Prisma 或数据库连接。浏览器结果及限制见各仓 README 和 Web 工程说明。数据库验证与浏览器应串行，禁止在同一库并发运行两套夹具。
