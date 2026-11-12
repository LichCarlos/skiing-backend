# Kafka 停机恢复与多消费者再平衡验收

2026-11-04 当前续验：独立Linux环境完整十项真实集成全部通过、无跳过，包含35秒心跳、三分区再平衡、进程中断恢复及Nest停机排空，前后结构/数据/topic/group及服务清理均通过。见[当前证据与边界](linux-kafka-validation.md)。下方2026-11-03及更早计数、未验或失败描述保留为当时历史；Windows文件语义问题未在Windows修复，生产集群/供应商仍待验。

2026-11-03 Kafka长任务心跳续修：当前消费者已补[长任务心跳与失败排空](kafka-handler-heartbeats.md)，新增8项单测通过，真实35秒用例尚未运行；完整套件现预期10项。既有Windows失败仍未解决，下方九/八项与通过统计仅为各自历史范围。

2026-11-03 原生Kafka诊断：原生恢复控制适配器已实现并有20项隔离回归，但当前broker因Windows topic目录重命名失败，完整九项未通过；不要将其解释为实际中断/再平衡成功。三轮临时服务均停止，见[当前诊断](native-kafka-validation.md)。原Docker分支及其标记/镜像/端口检查保留，Docker未启动/重启。

后续生命周期实现见[后台任务与资源停机顺序](worker-shutdown.md)：producer清理已迁至beforeApplicationShutdown，专项入口也纳入真实Nest关闭/HTTP排空/RAG重放场景。本页八项与统计保持本阶段历史证据，当前专项总数与回归结果以该续验及阶段交付记录为准。

日期：2026-11-02。本记录接续 [Kafka/RAG 集成验收](kafka-rag-integration.md)。执行生产 Kafka publisher/consumer、Outbox 派发与租约 SQL、Inbox、RAG 来源读取/写入和 pgvector；仅 Embedding 使用确定性的 1024 维向量替身。OpenAPI 1.50.0 / 143 操作、数据库迁移和运行时依赖没有变化。

## 修复的实际问题

OutboxDeliveryService 原先在批次开始时只读取一次时间。broker 连接/发送失败等待超过退避时间后，AvailableAt 已经过期，下一轮会立即再试；PublishedAt 也记录为发送之前的批次开始时间。

新增两项回归先复现失败：发送等待 15 秒后失败，重试应在第 16 秒；连续两次发送各等待 5 秒，确认时间应分别为第 5、10 秒。随后将时钟读取移至每条消息的成功确认/失败处理处。时钟作为构造器可选依赖，仅供测试控制，生产每次读取当前时间。原五项及新增两项全部通过。

修复不改变状态机、最大尝试次数、租约或同 EventId 重发规则。Kafka 与数据库之间仍采用至少一次投递和 Inbox 幂等，不能承诺端到端 exactly-once。

## 真实服务专项

完整 `pnpm test:integration`：8 项通过，124.47 秒，包含原六项与新增两项。生产发送器、消费者和数据库没有替身。

| 新增场景                | 实际断言                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| broker 停机/恢复        | 先发送并索引一条；停止同一个专用容器；业务与 Outbox 仍可提交，实际发送失败后保持 pending、Attempts=1、无发布确认/Inbox/向量，重试时间晚于失败返回；重启原容器后，原 publisher/consumer 对象继续完成投递，Attempts=2、offset=2，前一条向量 ID 不变 |
| 三分区/两个消费者再平衡 | 第二个生产 consumer 加入同组后达到 Stable/两成员；所有分区都收到显式测试消息和生产 Outbox 消息并提交到末尾；同 EventId 不重复生成向量；一个成员退出后剩余成员接管全部分区，再次跨分区重放仍保持原向量 ID/索引时间，四个有效 Inbox、四次 Embedding |

停机期间日志中的 ECONNREFUSED/consumer cycle failed 是故障注入的预期结果，日志保留。未修改 KafkaJS 重试参数或替换发送器来让故障提前结束。测试在 finally 中恢复 broker，随后走正常 topic/group/业务记录清理。

Kafka 验证库执行 23 项迁移、双 seed、前后 db:verify；专项清理后 User=1，ProjectKnowledge/RagDocument/OutboxEvent/ConsumedEvent 均为 0。

另一个专用库 `linji_password_validation` 完成全部 34 文件/823 项真实数据库测试（421.11 秒），以及 4 文件/126 项 HTTP e2e（16.74 秒，HTTP 套件按既有定义使用应用端口替身，不与真实数据库套件混称）；双 seed、测试前迁移及测试后 db:verify 通过。最终 User=1，ProjectKnowledge/RagDocument/OutboxEvent/ConsumedEvent/OperationLog 均为 0。

三仓独立冻结安装、check、build/导出通过：Backend 130 文件/1041 项，Web 1459 项及官网/Admin 两构建（均缓存命中），App 56 文件/998 项、Doctor 20/20 和 iOS/Android/Web 导出。App 产物在 `D:/linji-kafka-recovery/20261102/app-export`。三份 OpenAPI SHA-256 均为 `adaa39927fab990393b5d9213cf81eebea2f500d456aa93deefa006cb79d40c0`；没有前端业务改动。

## 独立运行与故障注入约束

在本仓根目录执行，需提前准备仅用于本次测试的 PostgreSQL/pgvector 与 Kafka 4.1.1。Outbox 会领取整个库到期事件，禁止指向共享开发库或生产库。

```powershell
pnpm install --frozen-lockfile
# 使用专用环境注入 DATABASE_URL、INITIAL_ADMIN_ACCOUNT、INITIAL_ADMIN_PASSWORD。
# KAFKA_INTEGRATION_BROKERS 为宿主机可达、与 advertised listener 一致的地址。
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm db:seed
pnpm db:verify
pnpm test:integration
pnpm db:verify
```

默认执行七项并明确跳过真实停机用例。要执行全部八项，额外设置：

```powershell
$env:LINJI_DATABASE_TEST_DISPOSABLE = 'true'
$env:KAFKA_RECOVERY_CONTAINER_ID = '<专用 Kafka 容器完整 64 位 ID>'
pnpm test:integration
```

`test/helpers/kafka-recovery-broker.ts` 在任何停机前校验完整 ID、`apache/kafka:4.1.1` 镜像、`linji.validation=kafka-recovery` 标签、非 AutoRemove、运行状态及唯一 broker 与容器 9092 映射端口一致，且客户端地址必须是 localhost/127.0.0.1。不要给现有业务容器补标签来通过检查。临时 broker 的数据目录放在可跨容器 stop/start 保留的目录，测试结束后由环境创建者回收自己的容器和卷。

本地专用容器：

- PostgreSQL：`linji-kafka-recovery-db-20261102`，ID `1d1abbe97b579731293f574f37a1deea101ba04c06fe94426c9b353127b946ca`，回环端口 63011；Kafka 库 `linji_kafka_recovery`，完整数据库回归另用 `linji_password_validation`，不与专项并发修改同一库。
- Kafka：`linji-kafka-recovery-broker-20261102`，ID `0a02d502ef7d19c15708520f0557212fa4abf6a8886a577251e51f8e63dc490a`，回环端口 63012，数据目录 `/tmp/linji-kafka-data`。

以上地址仅是本轮验收证据，不写入产品 `.env`。临时凭证位于工作区外，清理时删除；日志为仓库忽略文件 `kafka-recovery-*.log`。三端仍独立安装、配置与发布。

收尾从宿主机 KafkaJS Admin 确认只剩内部 `__consumer_offsets`，测试 topic/group 均为 0。此前从容器内运行 Kafka CLI 的附加核对因 advertised listener 为宿主机 `127.0.0.1:63012` 而超时；改用与产品相同的宿主机客户端核对通过，没有更改 listener 或测试结果。该次失败日志保留。

已按完整 ID、名称和标签核对后删除本轮两个容器及四个匿名卷，63011/63012 无监听；工作区外临时凭证文件已删除，原五个无关容器保持运行。清理报告保留于 `D:/linji-kafka-recovery/20261102/cleanup.json`，导出产物及忽略日志保留。未提交、推送或部署。

CI 的 `kafka-integration` 服务增加专用标签，步骤传递 `${{ job.services.kafka.id }}`，使完整八项可在独立 job 运行。远程 CI 尚未执行。

## 验证边界

本轮 broker 测试是单节点 stop/start 并保留原数据，不能证明多 broker 复制/选主、磁盘损坏、消息过保留期、生产灾备或性能。再平衡测试覆盖消费者正常加入/退出和三个分区，不覆盖在途长时间 Embedding 超过会话时限、消费者强杀或网络分区。真实模型/Embedding 供应商、实际浏览器/原生设备与生产部署仍未验收。
