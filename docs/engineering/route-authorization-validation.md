# 全部 HTTP 路由授权与角色分页边界

日期：2026-11-02。OpenAPI 保持 1.50.0 / 143 个操作，无新接口、依赖、权限语义或数据库迁移。

## 修复与证据

[ManageRoles](../../src/modules/platform-administration/application/manage-roles.ts) 原先只检查偏移量是否为 JavaScript 安全整数。`page=2147483649&pageSize=1` 与 `page=21474838&pageSize=100` 仍可进入仓储，但超过 Prisma 的 int32 偏移量范围。新增两项回归先失败，修复后在应用层返回 400；支持的最大偏移量 2147483647 仍原样传递给仓储。单元测试与真实 HTTP 校验均覆盖拒绝路径，不改变正常分页响应。

新增 [完整路由 HTTP 测试](../../test/route-authorization.e2e-spec.ts)，加载生产 AppModule、实际 HTTP 配置与 WebCsrfGuard / AccessTokenGuard / AuthorizationGuard。仅替换 Prisma、会话与授权主体读取端口；JWT 采用实际 HMAC 实现签发和验签，测试不连接数据库或 Kafka。

路由清单从锁定的 OpenAPI 读取，并与 Nest 实际注册的控制器逐项比较。16 个公开操作通过人工显式清单检查；其余 127 个操作必须声明权限，权限键须属于现有目录，资源范围键须属于权威资源目录；104 个管理端和商家操作还必须声明管理入口限制。公开清单独立于 `@Public` 反射结果，误加公开声明会失败。

这里的公开表示不要求 access JWT；refresh/logout 等认证操作仍执行其自身的 refresh 凭证及浏览器 CSRF 校验。矩阵只静态核对这些公开声明，正常公开请求与认证/CSRF行为由既有HTTP套件验证。

HTTP 矩阵逐一验证 127 个受保护操作在匿名、无效 JWT、撤销会话、主体不存在、停用账号、停用角色、撤销 grants、停用 grants 时的 401/403；另对 104 个管理操作验证保留业务权限但撤销入口权限仍为 403。合计 1120 次拒绝请求。请求没有 Origin/Cookie，使用既有原生 Bearer 协议；浏览器 CSRF 专项由既有套件负责。

同一未过期 JWT 还在实际资源目录接口完成 200 → 撤销 `system:role:list` 后 403 → 恢复后 200 → 会话撤销后 401，确认每次重新读取服务端授权及会话。两项 HTTP 分页溢出测试验证已授权请求仍返回 400。该文件共 13 项测试、1126 次 HTTP 请求；静态清单检查自身不发请求。

## 复现

在 Backend 根目录使用 PowerShell：

```powershell
$env:VITEST_MAX_WORKERS='1'
$env:NODE_OPTIONS='--max-old-space-size=1536'
pnpm exec vitest run src/modules/platform-administration/application/manage-roles.spec.ts
pnpm test:e2e
pnpm check
pnpm build
```

初轮分页失败保留于 authorization-audit-before.log。路由专项初轮运行通过，但类型检查发现 ESM constants 导入后缀及反射目标类型错误，修复后复验；失败日志 authorization-audit-typecheck.log 保留。最终全量结果记录于[阶段交付记录](../../../docs/07-交付归档/阶段交付记录.md)。

## 验证边界

本轮本仓冻结安装、完整 check（136 文件 / 1148 单元测试）、7 文件 / 143 HTTP与框架测试以及 build 通过。最后增加HTTP分页用例后再次lint/typecheck通过。编译后OpenAPI导出在数据库/Kafka不可达且两个消息开关启用时成功；三端契约的1.50.0/143操作及SHA-256 `adaa39927fab990393b5d9213cf81eebea2f500d456aa93deefa006cb79d40c0`一致。日志前缀 authorization-audit-，失败复现与最终结果分别保留。

Web配套独立冻结安装、完整check 1459项及官网/Admin构建通过，两个构建命中缓存。App独立冻结安装、完整check（56文件998项）及Doctor20/20通过；iOS/Android/Web导出进程退出码0，产物位于 `D:/linji-authorization-audit/20261102/app-export`。三端README和共享生命周期文档已同步，前端业务与协议保持。

此矩阵验证路由覆盖、真实全局守卫与即时授权读取；它不验证真实数据库中的撤权事务、并发执行中的授权时序、每一条合法业务请求及所有数据隔离投影。既有数据范围/写入事务测试继续有效，本阶段没有确认新的读取越权漏洞，也不将权限矩阵描述为全系统安全验收。

Docker 保持不重启。真实数据库复验、应用容器、实际浏览器/原生设备、供应商模型 ID 与生产恢复仍在待办中；不会用历史数据库结果替代本阶段证据。
