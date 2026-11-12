# App自助改密真实HTTP验收夹具

2026-11-02；OpenAPI1.50.0，无业务schema/API或依赖变化。仅增加独立测试夹具 `scripts/settings-http-fixture.ts`，后端生产认证实现保持。App通过HTTP连接，不导入后端源码或接触数据库。

本轮新建loopback专用pgvector/pg17库 `linji_settings_validation`，23迁移、双seed及db:verify通过。脚本只接受该专用库且要求 `SETTINGS_HTTP_FIXTURE_CONFIRM=linji_settings_validation`；`create`要求库中仅1个seed账号，密码从进程变量 `SETTINGS_HTTP_FIXTURE_PASSWORD`读取，生成2个注册用户。忽略的storage清单仅含数据库名称、模拟账号及ID，不保存密码/token。

从本仓配置新库DATABASE_URL及INITIAL_ADMIN_ACCOUNT/PASSWORD，分别运行db:deploy、两次db:seed、db:verify和 `pnpm exec tsx scripts/settings-http-fixture.ts create`。单独启动Nest，关闭Outbox调度与Kafka消费者；仅把HTTP基址和模拟清单通过环境交给App。App本仓 `pnpm test:settings-http` 使用真实api-client/auth-session/SessionController/设置控制器，替换Native存储模块而保留真实HTTP/Nest/BCrypt/PostgreSQL。

两项联调通过：错误旧密码不改密；正确改密返回204，App身份匿名、本地凭证清理，旧access/refresh拒绝；另一账号真实提交204后注入响应丢失，客户端未知状态阻止再次改密，手动退出清理凭证。验证脚本 `verify`逐账号断言一条account:password:change成功审计及零有效会话，结果通过。原生设备存储、React渲染与导航并未被这一测试替代。

完成后停止本轮服务，`cleanup`只删除清单中的模拟用户和相应审计，保留seed；再次db:verify通过，核对User1/OperationLog0/AuthSession0，再仅停止本轮已核实ID/标签的AutoRemove容器。未连接原业务库或修改已有容器。

本阶段Backend独立冻结安装、lint/typecheck、130文件1039单测及build通过。未重跑完整823数据库/126HTTP套件，前阶段数字仅作历史证据；本阶段新增真实HTTP两项由App执行，数据库持久断言由本仓verify执行。生产恢复、远程CI、供应商和完整设备验收仍待完成。日志settings-flow-保留并忽略入库。
