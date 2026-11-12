# App 收藏恢复的独立 HTTP 核对

日期：2026-11-03。生产接口及业务数据模型保持 OpenAPI 1.51.1 / 143 操作、24 项迁移。本仓仅扩展本机验收运行器及既有夹具，没有改动生产授权或收藏规则。

`pnpm test:native-resort-http` 使用已准备的 Windows 原生 PostgreSQL 17 运行时，为 `linji_resort_list_validation` 创建全新临时实例，应用迁移、两次 seed 与前置数据库核对，再建立两账号、22 个公开雪场、一个待审核雪场和三个标签。夹具路径可用 `RESORT_LIST_FIXTURE_PATH` 指定在临时目录，默认路径保留兼容。编译 Nest 启动后输出不含凭证的 ready.json；夹具密码只由进程环境传递。

环境要求：`LINJI_NATIVE_PG_ROOT` 指向已经准备好的 PostgreSQL 运行时；`LINJI_NATIVE_PG_OUTPUT` 指向当前阶段的独立临时输出目录；`ADMIN_AUTH_HTTP_PASSWORD` 为仅用于该隔离库的随机测试密码。先独立冻结安装、check 和 build，再运行脚本。它不安装 PostgreSQL，不启动 Docker 或 WSL。

独立 App 仓库按 ready.json 获得接口地址和非凭证夹具，并通过进程环境取得测试密码；运行 `pnpm test:resort-list-http`。套件仍使用生产 HTTP client、QueryClient 与收藏控制器，新增按账号共享账本的页面替换、未结束请求门禁及重新登录隔离场景，具体见 [App 工程说明](../../../app/docs/engineering/favorite-runtime-recovery.md)。不得将控制器替换等同于真实设备上的页面操作。

客户端成功后才向该次运行目录的 stop.request 写入 `passed`。运行器随后检查两账号各仅一条收藏，且分别指向各自雪场、没有文章收藏，再执行数据库核对；最后停止 API 和 PostgreSQL、删除临时初始化密码文件。临时数据库文件和脱敏日志保留用于复核，不能描述为数据库目录已删除。失败也保存报告并停止服务。

本轮另外在独立全新数据库重跑既有管理授权 HTTP 套件，以核对共享运行器其他分支。具体测试结果、端口关闭证据及日志哈希见[本仓验证报告](../validation/app-favorite-recovery-20261103.json)。本轮没有 Kafka、模型、Embedding、S3、Docker 或浏览器/设备验收；D-49/D-50/D-09 保持待决，整体项目未完成。
