# Kafka 与真实模型的组合链路验收

日期：2026-11-04。负责人：Backend。状态：9 项真实组合专项全部通过，三仓独立工程复验和清理完成。OpenAPI 保持 1.51.1 / 143 操作，数据库保持 24 项迁移。

## 范围

本轮选择项目知识作为业务入口，实际装配 `KnowledgeContentModule`、认证、AI 和消息模块，使用既有管理 API 写入资料。没有替换 repository、Outbox store、publisher、consumer、Inbox、向量或对话 provider。计数 spy 始终调用正式适配器的原方法；生产实现不因测试改变。

```text
管理员 Bearer HTTP
  → 用例与事务：项目知识 + OperationLog + Outbox
  → OutboxPollingWorker → KafkaEventPublisher
  → 专用 Kafka SASL_SSL / SCRAM-SHA-512
  → KafkaEventConsumer → Inbox → 项目知识 handler
  → 真实 BGE-M3 → PostgreSQL / pgvector
  → 普通用户 Bearer HTTP/SSE → DeepSeek → 持久化及引用
```

采用[已核验的 BGE-M3 Q8 运行时与模型](real-rag-validation.md)：llama.cpp b12097，固定模型 SHA、CLS/L2、1024 维，索引和检索使用 `bge-m3-q8-950f4a8e5e19`。本机 2048 token 配置只验证短合成文本。对话 API ID 为 `deepseek-flash`，本轮输出上限 512 token。凭证仅经私有进程环境传递。

专用 broker 为独立 Alpine/QEMU guest 中的 Kafka 4.1.1，TLS 及两组随机 SCRAM 账号由宿主运行器临时准备；应用账号仅获得 `linji-real-rag-` 前缀 topic 的 READ/WRITE 和 group 的 READ 三条 ACL。管理账号用于建 topic、设置 ACL 与核对清理。虚拟机使用 768 MiB，Java heap 320 MiB，仅转发回环端口；不使用 Docker 或其 WSL 发行版，也不接触其他项目 broker。

## 九项场景

| 编号 | 实际检查                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K01  | 普通用户管理写入 403，不产生业务 Outbox 或项目知识审计                                                                                                  |
| K02  | 管理 API 创建草稿；自动投递并完成 Inbox；草稿不调用 Embedding                                                                                           |
| K03  | 管理 API 发布；自动消费后写入真实 1024 维、L2 范数近 1 的 pgvector                                                                                      |
| K04  | 普通用户通过认证会话 SSE 查询 18:00 的合成事实，返回来源并保存消息                                                                                      |
| K05  | 先确认初始 offset 已提交，再经生产 publisher 向 Kafka 重放相同 EventId；等待 offset 前进，确认 Inbox 不重复调用 Embedding                               |
| K06  | 使用专用进程 capability 对 broker 执行 SIGKILL；管理 API 将新 19:00 事实保存到 Outbox；SQL 立即拒绝旧向量；同盘 broker 恢复后真实 worker 补投并重建向量 |
| K07  | 再次通过 SSE 提问，回答改为 19:00 且带来源                                                                                                              |
| K08  | 管理 API 撤回，自动投递后停用索引；提问返回确定性无资料文本，不调用 Chat                                                                                |
| K09  | 管理 API 软删除，最终事件与 Inbox 完成，五次业务写命令各有一条审计                                                                                      |

测试内容全部为虚构的“合成北坡咨询服务站”，没有发送实际用户、雪场或内部业务资料。两个真实对话结果不代表大规模语料质量评估。

## 复现条件

独立入口为 `pnpm test:rag-kafka-live`，只运行[组合专项](../../test/rag-kafka-real-providers.live-spec.ts)，不会加入默认单测或缺配置时静默跳过。

- 显式设置 `LINJI_REAL_KAFKA_RAG_CONFIRM=linji_real_kafka_rag_validation`，数据库必须是回环专用库 `linji_real_kafka_rag_validation`。按 `.env.example` 配置认证秘密与初始管理员，并完成 `db:generate`、`db:deploy`、`db:seed`、`db:verify`。只保留 seed 基线，不能复用业务库。
- 提供真实 Chat/Embedding 的既有配置及 `INITIAL_ADMIN_ACCOUNT/PASSWORD`。这会实际调用供应商并可能产生费用。
- 提供[安全 Kafka 测试命名空间](../../test/helpers/kafka-integration-transport.ts)的 brokers、CA、SCRAM 应用账号与管理账号；`KAFKA_INTEGRATION_SECURITY_ENABLED=true`，两者身份必须不同，应用账号不能是 broker 超级用户。
- 提供[专用原生恢复 capability](../../test/helpers/native-kafka-recovery.ts)的回环 URL、随机 token 和 `LINJI_DATABASE_TEST_DISPOSABLE=true`；不配置容器 ID。本入口直接验证 capability，不回退调用 Docker。
- `LINJI_REAL_KAFKA_RAG_RUN` 必须为仓库外绝对目录，解析符号链接后仍在仓库外。结果仅输出合成回答、来源、调用次数和事件 ID。

测试通过 Config 装配启用真实 Outbox/consumer，以 100 ms 间隔轮询。Vitest 默认禁止生产 worker，因此仅在 `app.listen()` 执行 bootstrap hooks 时临时设置 `NODE_ENV=live-rag`，随后恢复原值。业务写入由后台 worker 自动驱动，没有手工调用 `dispatchBatch` 或 RAG handler；K05 单独通过生产 publisher 重放重复消息。结束时先 `app.close()` 排空 worker/consumer/producer，再清理本专项数据及 topic/group。运行器负责数据库和模型停止、guest 关机、端口和临时密码核对。

本机运行器与原始日志在 `D:/linji-kafka-real-rag/20261104`。运行器复用已校验的模型和只读基础 guest 磁盘，每次创建新的进程、数据库和 qcow2 overlay，避免改动此前验收快照。

## 结果与限制

最终运行 `run-123628` / 模型进程 `run-20261104043624627`：9/9、零跳过，Vitest 总耗时 109.39 秒。实际 Embedding 调用 6 次、DeepSeek 调用 2 次；两次合成回答分别为 18:00 和 19:00，均含 `[S1]` 及项目知识引用。应用账号只获三条前缀 ACL。停机期间连接重置/重连错误为主动故障注入的预期日志，验收由业务恢复、Inbox 和引用结果判定。

三仓新 D 盘副本独立冻结安装/check 通过：Backend 1323 单测/20 源码工具/173 HTTP 框架及构建/编译 OpenAPI，Web 3045 业务/20 源码/20 发布工具、官网/Admin 双无缓存构建与 standalone 核对，App 1217 业务/20 源码/10 产物工具、Doctor 20/20、三平台导出及 88 文件封存迁移。24 迁移/双 seed/前后结构校验通过；五端口关闭、guest 正常退出、基础磁盘摘要保持，测试业务/索引/事件/会话、认证 session/refresh、捕获的限流桶及审计清理通过（保留 seed 管理员）。生产源码/schema/锁文件不变，契约保持 1.51.1 / 143 操作；28 项真实 RAG、22 项 Kafka 与完整 858 项数据库套件为前轮独立证据，本轮不重复计数。

首轮诊断亦 9/9；最终副本额外核对了 seed 管理员临时 session、refresh token 和捕获的登录限流桶清理。初期 IntegrationEvent JSON 类型错误已修正，失败日志保留；两次专项分别归档，不合并计数。摘要见[本仓证据](../validation/kafka-real-rag-20261104.json)。

生产模型常驻与容量、真实业务语料/人工质量及所有来源的长期索引、浏览器/Expo Web/原生设备与签名包、生产存储/集群/容器/远程 CI 仍待验；D-49/D-50/D-09 保持待决。未启动/重启 Docker 或借用其 WSL，未重试此前被拒绝的操作，整体目标尚未完成。

本轮范围为单 broker、单分区、项目知识与合成语料的实际消息和模型链路；不据此声称端到端 exactly-once、所有来源的大规模质量、集群选主或生产容量已验收。雪场/文章的真实向量召回及 20 个合成问题见[上一阶段](real-rag-validation.md)，此前安全专项 12 项及消息集成 10 项见[独立 Kafka 记录](kafka-secure-broker-validation.md)，不合并计数。

目标浏览器/Cookie-CSRF、Expo Web/原生设备与签名包、模型常驻/真实业务语料/容量、生产存储/集群/容器和远程 CI 仍需验收；D-49/D-50/D-09 保持待决。整体目标尚未完成。
