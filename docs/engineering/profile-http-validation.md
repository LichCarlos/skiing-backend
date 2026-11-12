# App资料编辑真实HTTP验收夹具

2026-11-02；OpenAPI1.50.0，无生产API/schema/依赖变化。独立夹具 `scripts/profile-http-fixture.ts create|verify|cleanup` 仅接受loopback专用库 `linji_profile_validation`，且要求 `PROFILE_HTTP_FIXTURE_CONFIRM=linji_profile_validation`。create还要求库中只有1个seed账号、没有旧清单；密码通过 `PROFILE_HTTP_FIXTURE_PASSWORD` 环境变量传入，散列后创建2个绑定registered_user系统角色的模拟用户。ignored的storage清单仅保存专用库名、账号和ID，不保存凭证。

本仓配置专用DATABASE_URL、INITIAL_ADMIN_ACCOUNT/PASSWORD后运行 `pnpm db:deploy`、两次 `pnpm db:seed`、`pnpm db:verify` 和 `pnpm exec tsx scripts/profile-http-fixture.ts create`。启动编译后的Nest，设置 `OUTBOX_DISPATCH_ENABLED=false`、`KAFKA_CONSUMER_ENABLED=false`，仅将HTTP地址、模拟清单和模拟密码交给独立App运行 `pnpm test:profile-http`。App不导入后端代码或直连数据库。

本阶段新建pgvector/pg17可销毁库，23迁移/双seed/结构验证通过。真实HTTP两项通过：账号一先只改昵称保留legacy头像，再显式null清除；账号二真实PATCH成功后注入客户端响应丢失，禁止重复写入，刷新只读并经人工确认恢复编辑。Native SecureStore为唯一参与流程的替身；没有实际相册/上传/S3/扫描验收。

`verify`断言数据库实际昵称、Avatar/AvatarAssetId及两个账号分别2条/1条account:profile:update成功审计。`cleanup`先核对清单账号和ID关联，再只删除这些ID的模拟账号及审计，断言User1/OperationLog0/AuthSession0。清理后db:verify再次通过。本轮Nest进程和经完整ID/标签/AutoRemove核对的专用容器均已停止；其余5个容器未操作。

专用容器名称linji-profile-validation-20261102，ID `b290518881c94a22c1d679be05dec3a739a7482ac612c06bb94e576fd2328f59`，数据库仅绑定127.0.0.1:62302，Nest端口62312。日志profile-flow保留并忽略入库。最初合并启动及清理命令被自动审批拒绝，未执行；后续采用分步启动、核对身份和清理，全部完成。

本仓独立冻结安装、lint/typecheck、130文件1039单测和build通过。本轮未重跑完整823数据库或126HTTP套件，历史数量不能作为本轮执行结果。App两项真实HTTP和上述数据库持久断言是本阶段新增证据；生产恢复、原生设备、模型/Embedding/Kafka、独立冷启动及远程CI仍未完成。
