# Kafka、Outbox、Inbox 与 pgvector 集成验收

2026-11-04 当前续验：独立Linux环境完整十项真实集成全部通过、无跳过，包含35秒心跳、三分区再平衡、进程中断恢复及Nest停机排空，前后结构/数据/topic/group及服务清理均通过。见[当前证据与边界](linux-kafka-validation.md)。下方2026-11-03及更早计数、未验或失败描述保留为当时历史；Windows文件语义问题未在Windows修复，生产集群/供应商仍待验。

2026-11-03 原生Kafka诊断：当前Windows原生实验未通过：Kafka4.1.1 topic删除触发AccessDenied并关闭日志目录，结果1失败/8跳过。新控制能力单测20项通过不替代Kafka集成；见[当前失败与复验入口](native-kafka-validation.md)及[证据](../validation/native-kafka-20261103.json)。以下Linux容器结果仅作历史证据，当前原生结果未覆盖其完整范围。

2026-11-02 续验：[真实 broker 停机/恢复与三分区双消费者再平衡](kafka-recovery-validation.md)新增两项，完整八项通过；修复 Outbox 慢发送后的重试/确认时间戳，新增两项回归。当前契约为 OpenAPI1.50.0/143操作。以下 2026-10-29 的六项、版本号和未验证范围为当日历史记录，新覆盖范围以上述续验为准。

日期：2026-10-29。使用独立 PostgreSQL/pgvector 和 Apache Kafka 4.1.1，执行生产 publisher、consumer、Outbox 仓储/派发服务、Inbox、五类来源处理器、来源读取器、向量写入器和检索器。Embedding 使用固定 1024 维向量替身，不接入真实对话或 Embedding 服务。

## 实际发现与修复

修复前，消费者使用 fromBeginning=false。先完成业务/Outbox 事务并发布事件，再首次启动消费者组时，消息已经存在于 Kafka，但新组从末尾开始读取；真实回归测试等待提交 offset 1 超时。Outbox 此时已经 published，普通待发送扫描不会补发这条消息。

现改为 fromBeginning=true：新组从 Kafka 最早保留的位置读取；有有效已提交 offset 的组仍从该位置恢复。重复投递由事件 ID 与 ConsumerKey 的 Inbox 唯一键和租约处理。只在来源处理完成后提交 offset+1，保持 at-least-once；不保证模型调用、Kafka 和数据库之间端到端 exactly-once。Kafka 已过保留期的内容仍需通过既有 rag:reindex 重建，修改起点不会恢复已被 broker 删除的事件。

本地 Compose 的 advertised listener 同时改为跟随 KAFKA_PORT；仅修改宿主机端口却向客户端公布旧 9092 会导致客户端引导成功后无法连接元数据地址。已用 KAFKA_PORT=29092 验证解析结果为 localhost:29092。此配置面向在宿主机运行的 API；容器内网络部署应单独配置可达 listener。

## 用例与证据边界

独立命令 pnpm test:integration 使用 vitest.config.integration.ts，要求显式 DATABASE_URL 和 KAFKA_INTEGRATION_BROKERS；不并入无需外部服务的 pnpm check 或 test:db。每例使用唯一 topic、group 和业务记录，结束时关闭客户端，删除本例 topic/group，并清理本例数据。

| 用例           | 检查的实际行为                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 首次消费积压   | Outbox published 后启动新组，提交 offset，Inbox completed，pgvector 可检索                                              |
| Kafka 重复消息 | 相同 EventId 两次发送，offset 前进两次，只生成一套向量，已完成效果不重复                                                |
| 消费失败恢复   | 注入一次 Embedding 失败，真实消费者 CRASH/断开/重连；重试完成前未提交 offset，完成后可检索                              |
| 发送后丢失确认 | broker 已 ACK，但不标记 Outbox；模拟租约过期，生产派发服务重新领取并发送，旧 token 的确认失败，Inbox 不重复执行         |
| 停机期间撤回   | 已提交后关闭消费者，撤回知识并发布；同组恢复只处理后续事件，停用来源                                                    |
| 五类来源       | 雪场、文章、动态、项目知识、公开字典都通过真实 Kafka 建立向量；状态变化后查询立即隐藏旧向量，后续事件停用文档并删除向量 |

失败注入仅替换 Embedding 边界；KafkaJS、broker、Prisma、事务/租约 SQL、Inbox、来源处理器和 pgvector 均实际执行。消费者失败恢复用例没有重启 broker，不等于 broker 故障转移验证。当前使用单 broker、单分区、单消费者，不证明多分区顺序、集群复制、再平衡、跨版本升级或规模性能。

## 本轮环境

专用数据库容器 linji-kafka-validation-db-20261029，完整 ID 92192567f3706a46bc02042b7efdcfa2060049dc45fc44ebbc7dd7a564df3f8e，loopback 随机端口 57161，数据库 linji_validation。专用 broker linji-kafka-validation-broker-20261029，完整 ID 480fe541106aa67660d42f33e996d843194769d4615f3f3666ced01a84772539，loopback 随机端口 56999。两个容器均带 linji.validation=kafka-20261029、AutoRemove=true，无持久数据卷；不复用其他项目的数据库、broker 或服务。

Kafka 镜像 apache/kafka:4.1.1，拉取 digest sha256:0bc1bb2478f45b6cea78864df86acdc11e8df2c5172477819a4d12942cbe5d40。数据库使用 pgvector/pgvector:pg17。独立库已通过 19 个 migrations、两次 seed、db:verify、10 文件/66 项 test:db、清理后 db:verify 和二次 deploy 无 pending。具体最终集成结果及容器回收状态见 [阶段交付记录](../../../docs/07-交付归档/阶段交付记录.md)。

以上端口仅属于本次临时环境，不写入项目 .env，也不作为后续固定地址。测试前需新建隔离环境，不能直接把测试指向开发/生产库：生产 Outbox 派发器会领取全部到期事件；用例开始时检查不存在其他 pending/processing 事件，仍不能把此检查当作共享环境隔离保证。

## 独立复验与 CI

在本仓库根目录，为专用数据库设置 DATABASE_URL、INITIAL_ADMIN_ACCOUNT 和 INITIAL_ADMIN_PASSWORD，为专用 Kafka 设置 KAFKA_INTEGRATION_BROKERS，然后依次执行：

```powershell
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm db:seed
pnpm db:verify
pnpm test:integration
pnpm db:verify
```

测试通过公开生命周期启动消费者，短暂使用独立的 NODE_ENV=integration 来越过只用于普通测试的自动启动禁用；不会启用其他 Nest workers。生产使用时仍需显式配置 KAFKA_CONSUMER_ENABLED=true 和有效的 Embedding 地址、密钥、模型，并与已写入向量的模型/维度一致。

GitHub Actions 新增独立 kafka-integration job，提供独立数据库和 broker、执行上述迁移/双 seed/结构检查/集成测试。远程 job 尚未执行，本地通过不等于远程 CI 通过。没有新增 HTTP 路由/字段、依赖或数据库迁移，三端仍消费 OpenAPI 1.29.0。

最终结果：完整 6 项通过，耗时 40.66 秒；最终新增用例后的 lint/typecheck 通过，三仓检查/构建与 66 项数据库复验通过。集成测试清理后 db:verify 再次通过。上述两个专用容器已在核对完整 ID、名称、标签及 AutoRemove 后停止并确认自动移除，其他项目容器未改动。首次失败的积压回归记录保留，不改写为首次即通过。
