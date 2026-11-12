# 独立 Linux Kafka 验收

日期：2026-11-04。负责人：Backend。独立副本完整十项真实 Kafka/PostgreSQL 集成通过，无跳过，用时 233.30 秒；测试后数据、topic/group 和临时服务清理均通过。OpenAPI 1.51.1 / 143 操作、24 项迁移、生产代码及依赖保持。本轮结果见[验证摘要](../validation/linux-kafka-20261104.json)。

Windows 原生 Kafka 在删除 topic 时无法重命名仍打开的日志目录。为继续验证 Linux 文件语义，本轮在 D 盘使用便携 QEMU / Alpine，Kafka 数据位于 guest ext4；实际 Nest、KafkaJS、Prisma 和 PostgreSQL/pgvector 在 Windows 独立后端副本执行。没有启动、重启 Docker Desktop，也没有借用其 WSL 发行版。

## 环境与证据边界

QEMU 11.1.0 使用 TCG 软件模拟、2 个虚拟 CPU、768 MiB 内存；Alpine 3.22.7 / Linux 6.12.114-0-virt，OpenJDK 21.0.11，Kafka 4.1.1 单节点 KRaft。JVM 使用 320 MiB 最大堆及两处理器配置。PostgreSQL 17.11 / pgvector 0.8.1 在本次专用集群运行，执行 24 项迁移、双 seed 和结构校验。

QEMU [官方发行包及 SHA-512](https://qemu.weilnetz.de/w64/2026/)、Alpine [官方发行清单](https://dl-cdn.alpinelinux.org/alpine/v3.22/releases/x86_64/latest-releases.yaml)中的 ISO SHA-256、Apache Kafka 官方发行包 SHA-512 均已匹配。QEMU 从安装包解压使用，未安装系统服务；JDK 来自 Alpine 签名软件源。下载文件、校验值、脚本和所有尝试均保存在 `D:/linji-linux-kafka/20261104`。

最终运行使用新建 qcow2 覆盖层，只复用已正常关机的运行时磁盘；broker 指向此前不存在的数据目录，PostgreSQL 另建专用库。运行前后核对基础磁盘摘要，避免改写历史记录。broker 与控制入口只转发到宿主机回环地址。控制入口使用内存中的 256 位凭据，只支持 identity、stop 和 start；通过串口控制本次专用 Java 子进程，不接受外部 PID、路径或命令。

本机准备工具在 D 盘，属于环境验收辅助文件；它们不是应用 TypeScript 依赖、发布组件或部署方式。正常 Linux / CI 环境仍使用本仓 `pnpm test:integration`，按[既有恢复约束](kafka-recovery-validation.md)提供专用数据库、broker 和恢复能力。禁止将 Outbox 测试指向共享业务库。

## 本轮发现与修正

首次实际十项运行六项通过、四项失败。CreateTopics 已被 controller 确认，但 broker 元数据尚未传播；KafkaJS 2.2.4 的 waitForLeaders 遇到 UNKNOWN_TOPIC_OR_PARTITION 提前抛错，四项场景停在准备阶段。`test/helpers/kafka-topic-readiness.ts` 改为显式等待预期分区数、leader 和 ISR，轮询预算 25 秒，单次请求仍受 KafkaJS 自身超时控制，仅重试协议码 3、5、6。建 topic 和扩容三分区后均等待就绪；权限及未知错误立即抛出。新增七项回归通过。

第二次完整运行八项通过、两项失败，35 秒长任务心跳、三分区再平衡和 Nest 停机排空通过。broker 重启后测试管理员的 offset 读取遇到 NOT_COORDINATOR 直接退出，随后清理超时并影响下一个场景。`test/helpers/kafka-offset-observer.ts` 将 14、15、16 三种临时协调器错误标为 null，供既有有时限轮询继续观察；null 不等于空 offset -1，更不能满足目标提交断言。权限/未知错误继续抛出，offset 保持字符串精度。新增七项回归通过。

上述改动仅影响测试准备和只读观察，不改变生产重试配置、消费者、消息信封、Outbox/Inbox、业务事务或 API。业务断言、topic/group 删除、最终数据库计数均保留。第一次新增超时回归因 fake timers 未控制 node:timers/promises 而超时，改为可由测试时钟控制的普通计时器后十四项通过；这不涉及生产时钟。

## 完成标准与限制

必须取得完整十项通过且无跳过、测试后 db:verify、User=1 / ProjectKnowledge=0 / RagDocument=0 / OutboxEvent=0 / ConsumedEvent=0，以及非内部 topics 和 groups 均为空。再核对专用 JVM、guest、文件/控制服务和 PostgreSQL 退出、端口关闭、初始化密码和 postmaster.pid 文件不存在，才能将本轮专项标为通过。失败尝试及原始日志保留，不与最终成功次数相加。

最终运行位于 `D:/linji-linux-kafka/20261104/run-100658`：十项全部通过，24项迁移、双seed、前后结构校验通过，最终五项数据库计数精确匹配，非内部 topics 和 groups 为空。guest 正常关机（退出码0），文件/控制入口关闭，基础运行时磁盘摘要保持；PostgreSQL停止通过。十四项新增观察器回归纳入独立副本1285项单测，另20项源码工具及173项HTTP/框架检查、生产构建和编译后OpenAPI导出通过。完整858项数据库套件为前一字段阶段证据，本轮未重复执行。

Embedding 使用固定 1024 维向量，不能代替真实供应商验收。单 broker、进程强制中断与同盘恢复不证明多节点复制选主、宿主机断电、磁盘损坏、生产 TLS/SASL/ACL、性能或远程 CI。软件模拟结果也不能用作生产容量数据。Kafka 与 PostgreSQL 仍为至少一次投递和 Inbox 幂等，不承诺端到端 exactly-once。
