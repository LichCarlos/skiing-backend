# AI 跨页面恢复的独立 HTTP/SSE 核对

日期：2026-11-03。生产接口、权限、数据库与幂等规则保持 OpenAPI 1.51.1 / 143 操作、24 项迁移。本仓改动仅为已有 AI 夹具和原生 HTTP 验收运行器。

新增 `pnpm test:native-ai-http`。指定 `LINJI_NATIVE_PG_ROOT` 为预先准备的 PostgreSQL 17/pgvector 运行时，`LINJI_NATIVE_PG_OUTPUT` 为本次独立输出目录。本仓先冻结安装、check、build，再运行该命令；它创建全新临时数据库 `linji_ai_mobile_validation`，执行迁移、两次 seed 与前置结构核对，不连接共享开发库，不启动 Docker 或 WSL。

AI 夹具以独立子进程创建公开、草稿、私有三个来源及 vector(1024) 索引，随后启动本地模型/Embedding HTTP 替身。端口由本次运行分配；manifest 和调用计数位于本次临时目录，固定端口与 storage 默认路径仅为旧手动流程兼容。替身具有专用健康标记、随机进程内鉴权键；API 启动前验证替身就绪，报告不写密钥和数据库连接串。

运行器输出 ready.json 中的接口地址和非凭证夹具，独立 App 仓库取得这些信息及自行生成的临时账号密码后运行 `pnpm test:ai-http`。App 不引用本仓源码或数据库。测试范围见[客户端说明](../../../app/docs/engineering/ai-runtime-recovery.md)。仅在客户端通过后，向本次 stop.request 写入 `passed`，触发后置核对。

后置断言检查两会话共三轮、六条持久消息，其中一个会话四条、另一个两条；每轮只有一条 assistant 回答，全部引用指向公开雪场。问题 Embedding、模型调用及提示词公开性各为三次，原键重试没有新增调用或消息。一个会话软删除，三个来源向量仍保留。生产幂等与 pgvector 查询使用真实实现；固定向量与文本替身不证明真实供应商效果。

无论成功或失败，运行器均尝试终止自己创建的 API、模型替身与 PostgreSQL，并删除初始化密码文件；脱敏日志和数据库目录保留用于复核。报告分别记录 API、替身及 PostgreSQL 的停止结果，后续端口核对覆盖三个临时端口。另以全新数据库复验既有管理 HTTP 分支，避免只验证新增分支。

当前结果及源码/日志摘要见[本仓报告](../validation/ai-runtime-recovery-20261103.json)。本轮不验实际 React/Expo 导航、SecureStore、真实 DeepSeek/Embedding、Kafka、S3、容器或远程 CI。Windows Kafka 原有 AccessDenied 未解决；D-49/D-50/D-09 保持待决，整体目标未完成。
