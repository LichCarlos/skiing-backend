# 权限目录真实 HTTP 验证

日期：2026-11-03。负责人：后端维护者。对应 API-M04 / ADM-09，契约保持 1.51.1 / 143 操作、24 项迁移。

使用 `pnpm test:native-admin-http` 创建独立的本机 PostgreSQL / pgvector 验证库，完成迁移、两次 seed、前置校验后启动编译的 Nest；Web 通过 `pnpm test:admin-authorization-http` 使用生产权限目录读取器、表单 DTO 生成器和 CatalogWriteGate。Kafka 和定时消费者在此套件中不启动。未修改生产业务处理或 schema。

权限目录场景验证整棵管理树和单节点完整子树；管理员为合成普通账号绑定可配置角色，由该账号通过真实 API 创建一组目录/菜单/按钮、更新菜单及停用按钮。菜单已有子节点时 DELETE 返回既有 409，不写成功审计；目录保持 active、菜单保持 active、按钮变 disabled。同步注册表同时由前端门禁及后端 API 拒绝普通账号，即使该账号持有 update grant。

读取期间撤权通过传输包装器在真实详情响应后调用真实授权 API，然后由生产读取器的结束身份复核拒绝发布结果；未伪造服务端响应。后置校验逐项验证 catalogReads 标志、三个节点的父子编号/类型/状态/可见性、更新后的菜单名及五条同操作者成功审计。既有拒绝 trace 不得产生成功审计，账号/商家/收益/RAG/事件核对保持。

本轮结果见[验证报告](../validation/catalog-reads-20261103.json)。Cookie jar 为 Node 适配，不能证明浏览器 Secure/CORS/CSRF 环境或 React 页面行为。临时服务退出后另外检查端口关闭、postmaster.pid 与密码文件消失。没有启动/重启 Docker 或使用其 WSL 发行版；Kafka、真实存储/模型、容器、原生签名包和远程 CI 仍需独立验收，D-49/D-50/D-09 不在实施范围。
