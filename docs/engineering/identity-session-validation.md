# 认证会话与最后管理员的真实数据库验收

后续复验（2026-10-29 图片库阶段）：App 完整 check 已恢复通过，Doctor 20/20 与三平台 export 通过。本文超时保留为认证阶段当时结果；最新计数见各仓 README。本轮未重跑数据库 66 项。

日期：2026-10-29。状态：本节列出的 HTTP/数据库路径已实际通过，项目整体尚未完成。入口是 `test/identity-sessions.db-spec.ts`，自动纳入现有 `pnpm test:db` 与 CI，无新增依赖或 migration。

## 真实链路与覆盖

测试装配生产 `IdentityAccessModule`、HTTP 管线、DTO、Guard、Application、Prisma repository、BCrypt、HMAC JWT 与 PostgreSQL；不替换认证服务、密码散列、授权读取或会话仓储。Supertest 驱动测试服务器，不启动用户开发服务，也不宣称完整 AppModule 冷启动或浏览器/设备验收。

| 场景                    | 真实断言                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 注册                    | trim/小写账号、trim 昵称、绑定 registered_user、不自动创建会话；重复账号 409，密码 BCrypt 持久化且响应无凭证                            |
| 登录拒绝                | 未知账号、错误密码、disabled 账号均 401 且不新增会话                                                                                    |
| 刷新                    | 数据库仅存 SHA-256；轮换令牌变更、旧令牌 consumed、会话固定到期时间不滑动；重用后整个会话撤销，旧/新 access 与 refresh 均不可用         |
| 并发刷新                | 同令牌两次请求为一条 200、一条 401；检测重用后即使获胜请求的 access 也不可用，数据库仅有初始及一个替换令牌                              |
| 会话校验/退出           | JWT 未过期但数据库会话过期仍拒绝；活跃会话退出后 access/refresh 均拒绝，重复 logout 成功                                                |
| 实时授权                | 已签 JWT 在权限撤回或角色停用后被拒绝；账号停用后刷新拒绝并撤销会话                                                                     |
| Web Cookie              | access/refresh 为 Secure、HttpOnly、SameSite=Lax，响应不返回令牌；Origin/CSRF 拒绝发生在写入前；刷新重用撤销会话并清 Cookie             |
| 管理员创建账号/本人改密 | 通过真实 POST /admin/users 创建；本人错误旧密码不影响会话，正确改密撤销全部会话，旧密码拒绝、新密码可登录；审计不含密码、散列或令牌     |
| 最后管理员并发保护      | 两个 active 管理员同时停用、同时替换角色、混合停用/替换三种场景，各一条 200、一条 409；只剩一个有效管理员且仍可管理，只有成功命令写审计 |

共 12 项。管理员并发测试先持有受保护角色行锁，再启动两条真实 HTTP 命令，检查 `pg_stat_activity` 中至少两条相关 SQL 等待锁后释放；这比仅 Promise.all 发出请求提供更明确的实际竞争证据。测试在专用库暂时停用其他 fixture/seed 管理员，并在 finally 恢复，不允许与业务服务或其他文件并行共享数据库。生产已有角色行锁与最后管理员计数规则本轮未修改。

## 已修复的 Origin 缺口

此前 `WebCsrfGuard` 对没有 Origin 的请求直接放行；携带 access Cookie 的 `PATCH /account/password` 可跳过 CSRF，真实测试复现为 204。现有规则修正为：携带 access 或 refresh 会话 Cookie 的写请求必须提供允许的 Origin，并通过双提交 CSRF；缺少 Origin 返回 403。无 Cookie 的 App/Bearer 请求继续沿用原流程，安全读取不新增写入限制。

新增 9 项快速 Guard 测试，覆盖 App/Bearer、Cookie 安全读取、缺 Origin 的两种会话 Cookie、非允许 Origin、缺失/不匹配/有效 CSRF；真实数据库 Web 改密测试同时验证缺 Origin 被拒绝且原会话仍有效。没有新增路由、DTO/VO 或授权权限。

## 本轮证据与限制

- 三仓独立 frozen install 通过；Backend check 108 文件/606 项、HTTP e2e 3 文件/76 项、build/OpenAPI 通过；无 lint 警告。
- 独立 PostgreSQL/pgvector：19 个迁移、两次 seed、结构检查，以及 10 文件/66 项数据库测试通过；清理 fixtures 后 db:verify 再次通过。
- Web check 79 项与官网/Admin production build 通过。App 契约、lint、typecheck、64 项单测和三平台 export 通过；本轮 Expo Doctor 两次在 exp.host:443 连接超时，完整 check 未通过，保留网络限制，不禁用该检查。上阶段 20/20 仅为历史证据。
- OpenAPI 仍为 1.29.0，三仓 SHA-256 `51eaa6e1a4a46f855859b2caa400238cccd756c60c2f11a02da1377f967e8cf9` 一致。

首轮测试侧 BigInt 审计序列化、并发 fixture 账号重名曾失败，已分别改为类型安全序列化和每次生成独立账号后复验；未放宽数据库约束。Origin 缺口测试先失败后修生产 Guard。当前 66 项为完整套件成功结果，不把定向运行中的 skipped 计作通过。

临时容器 `linji-auth-validation-20261029`（完整 ID `bf35e79381c7e6f49b3e6c93356a59bd3d66d9a51417bb915eb55c0fad1e0ce5`），镜像 pgvector/pgvector:pg17，loopback 随机端口 62411。核对 ID、名称及 AutoRemove 后仅停止该容器并确认自动移除；测试凭证未写入 .env。用户开发服务及其他项目容器未改动，未提交/推送。

登录限流策略、全部管理员授权并发/事务撤权、浏览器实际 Cookie 策略、CORS/反向代理/TLS、App SecureStore 设备行为、远程 CI 与生产交付仍待完成；上述局部测试不外推为这些项目通过。
