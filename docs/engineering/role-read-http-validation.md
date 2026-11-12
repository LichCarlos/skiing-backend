# 角色读取与授权目录真实 HTTP 验证

日期：2026-11-03。负责人：后端维护者。对应 API-M03 / ADM-07、ADM-08；契约仍为 1.51.1 / 143 操作、24 项迁移。

复用独立的 `pnpm test:native-admin-http`，在显式配置的 Windows PostgreSQL / pgvector 运行时创建专用数据库，执行迁移、两次 seed、前置校验和夹具；编译 Nest 提供实际 Cookie/CSRF API。Web 的 `pnpm test:admin-authorization-http` 使用生产角色读取函数，后端角色与授权的生产业务代码没有改动。

本轮加入三个场景：完整角色列表/详情及授权快照、权限树、资源目录投影和后续空页；自定义角色通过原 PUT 配置 role 的 selected 范围，仅能读取指定角色，范围外仍按既有协议返回 403；另在真实角色详情返回后，通过管理员 API 撤销查询 grant，读取函数结束时的 `/auth/me` 复核拒绝发布旧结果。撤权期间传输包装器只负责触发实际 API，不伪造服务端响应。

客户端结果包含独立的 roleReads 标志，后端后置夹具逐项断言。同时保留原账号/商家/收益、字段隔离、审计、RAG 来源和事件操作的持久核对；拒绝请求 trace 不得出现成功审计。所有测试账号会话退出，API 和临时 PostgreSQL 停止后再次检查端口与凭据临时文件。

本轮结果见[验证证据](../validation/role-reads-20261103.json)。这里的 Cookie jar 是 Node 适配，生命周期测试也不是实际页面渲染；未启动 Next/Expo 开发或生产服务，未启动或重启 Docker。Kafka/Inbox/定时器、真实浏览器/设备、供应商、容器、签名包与远程 CI 仍需独立验收。商家资料夹具不能代替待确认 D-49 的产品能力；D-50 与 D-09 同样保持未实施。
