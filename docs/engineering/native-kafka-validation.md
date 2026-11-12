# Windows 原生 Kafka / PostgreSQL 集成验收

2026-11-04 当前续验：独立Linux环境完整十项真实集成全部通过、无跳过，包含35秒心跳、三分区再平衡、进程中断恢复及Nest停机排空，前后结构/数据/topic/group及服务清理均通过。见[当前证据与边界](linux-kafka-validation.md)。下方2026-11-03及更早计数、未验或失败描述保留为当时历史；Windows文件语义问题未在Windows修复，生产集群/供应商仍待验。

2026-11-03 Kafka长任务心跳续修：当前消费者已补[长任务心跳与失败排空](kafka-handler-heartbeats.md)，新增8项单测通过，真实35秒用例尚未运行；完整套件现预期10项。既有Windows失败仍未解决，下方九/八项与通过统计仅为各自历史范围。

日期：2026-11-03。负责人：Backend。此入口用于本地独立验收，不是生产 Kafka 部署方式。运行证据及适用范围以[本轮摘要](../validation/native-kafka-20261103.json)为准。

**当前状态：实验入口已实现，原生完整集成验收未通过。** 第三轮实际启动了 Kafka 并执行在途停机/恢复，但测试清理删除 topic 时发生 `AccessDeniedException`，broker 关闭全部日志目录；结果为两文件失败、1 项失败 / 8 项跳过，无通过项。没有修改删除断言、跳过失败场景或将历史 Linux 容器结果记为当前原生通过。后续完整复验需要支持 Kafka 文件语义的隔离环境；本轮没有启动、重启或借用 Docker Desktop 的 WSL 发行版。

此前两轮分别在 UUID 输出解析和本机 JDK 内部 UNIX socket 临时目录处失败，均在完整集成测试前结束。已修正唯一 UUID 行解析，并为验收 JVM 设置专用 `java.io.tmpdir` / `jdk.net.unixdomain.tmpdir`；独立 Selector 探针验证该设置。三轮临时服务均已关闭，详细日志保留。新增控制适配器的 20 项隔离测试通过，仅证明参数和控制协议防护，不证明 broker 故障恢复已经验收。

`pnpm test:native-kafka` 在显式提供的输出目录中创建临时 PostgreSQL 17 / pgvector 集群及 Kafka 4.1.1 KRaft 单节点目录。要求预先准备 Java 21、官方 Kafka 二进制发行包及 PostgreSQL/pgvector；脚本不下载、安装系统服务，也不调用 Docker。Kafka 包应先根据 Apache 官方 SHA-512 文件核对。不要借用业务数据库、broker 或 Kafka 数据目录。

```powershell
$env:LINJI_NATIVE_PG_ROOT = 'D:/runtime/pgsql'
$env:LINJI_NATIVE_KAFKA_ROOT = 'D:/runtime/kafka_2.13-4.1.1'
$env:LINJI_NATIVE_JAVA = 'D:/runtime/jdk21/bin/java.exe'
$env:LINJI_NATIVE_KAFKA_OUTPUT = 'D:/validation/kafka'
$env:NODE_OPTIONS = '--max-old-space-size=1536'
$env:VITEST_MAX_WORKERS = '1'
pnpm install --frozen-lockfile
pnpm test:native-kafka
```

入口不使用已有 DATABASE_URL 作为测试目标，而是在本次临时集群中另建专用 `linji_kafka_validation` 并覆盖子进程连接配置。执行全部迁移、双 seed、前置 db:verify，再复用既有 `vitest.config.integration.ts`。用例覆盖 Kafka publisher/consumer、Outbox/Inbox 仓储与 SQL、来源读取、pgvector 和 Nest 关闭顺序；本轮执行范围以失败日志为准，没有完成全部场景。Embedding 仍为固定 1024 维测试替身，没有接入真实供应商。

Kafka 直接通过 Java classpath 启动，避免 Windows 批处理命令长度和 shell 引用问题。broker listener、controller listener 和临时控制入口均绑定随机回环端口；Kafka 数据、日志和 PostgreSQL 数据均位于本次 mkdtemp 目录。JVM 只设置本入口的内存、日志和专用临时目录参数，不修改系统 Java、环境配置或其他项目进程。

故障用例通过一次性 256 位控制凭据请求临时 HTTP 入口，只有固定 identity / stop / start 路由。入口仅持有本次 spawn 返回的 ChildProcess，不接受客户端 PID、路径、命令或 broker 地址。测试适配器校验回环 URL、独立库标记、凭据格式、唯一 broker 及版本/身份/运行状态；原 Docker 容器验证分支保持，并拒绝原生控制与容器 ID 混用。凭据不写入 ready 文件、日志或仓库。

Windows 的 ChildProcess.kill 终止专用 JVM，用例随后以相同数据目录重启新 JVM；这属于进程中断恢复，不等同于 Kafka 优雅停止，也不证明宿主机断电或磁盘写入持久性。Nest app.close 的正常停机仍由独立的在途 HTTP/worker 测试验证，不把两种关闭方式混为一谈。

成功后再次执行 db:verify，并确认仅剩初始化账号，项目知识、RAG 文档、Outbox、Inbox 均无测试残留，业务 topic 和 group 均清理。最后关闭控制入口、当前专用 JVM 和 PostgreSQL；报告保存迁移数、版本、broker 启停 PID、检查结果及清理状态。保留数据与日志用于诊断，不递归删除文件或凭名称终止外部进程。失败时同样尝试关闭，并在报告中明确失败，不能仅根据脚本结束认定服务已停止。

既有集成场景、断言与限制见[Kafka / RAG](kafka-rag-integration.md)、[停机恢复与再平衡](kafka-recovery-validation.md)和[Nest 资源停机顺序](worker-shutdown.md)。入口拟复用单节点、三分区、消费者正常加入/退出、重复投递、发送后确认丢失、进程中断及在途停机恢复九项场景，当前没有完成它们的原生验收；也不证明多 broker 复制选主、规模性能、生产 TLS/SASL、真实模型供应商、容器发布或远程 CI。Kafka 与数据库之间继续采用至少一次投递和 Inbox 幂等，不承诺端到端 exactly-once。
