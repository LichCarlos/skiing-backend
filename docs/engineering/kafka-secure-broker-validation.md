# 真实 Kafka 安全连接验收

日期：2026-11-04。负责人：Backend。真实 broker 安全专项 12 项与原有消息集成 10 项全部通过、无跳过；三仓独立副本最终工程复验通过，见[验证摘要](../validation/kafka-secure-broker-20261104.json)。OpenAPI 1.51.1 / 143 操作和 24 项数据库迁移保持。

## 测试入口

`pnpm test:kafka-security` 运行[真实安全连接测试](../../test/kafka-security.integration-spec.ts)，不会启动协议替身，不会因缺少环境静默跳过。`pnpm test:integration` 继续执行原有十项 Outbox / Inbox / pgvector、心跳、再平衡、进程恢复与 Nest 排空场景，使用同一安全传输配置。默认明文 CI 仍可使用，安全配置必须明确开启。

[测试配置转换](../../test/helpers/kafka-integration-transport.ts)仅使用以下测试环境变量，交给生产 [kafkaClientConfig](../../src/modules/integration-events/infrastructure/kafka-client-config.ts)检查 TLS 和认证配置。生产者与消费者实际使用应用账号；创建、观察和清理资源使用不同的管理账号。

| 环境变量                                                            | 含义                                            |
| ------------------------------------------------------------------- | ----------------------------------------------- |
| KAFKA_INTEGRATION_BROKERS                                           | 本次专用 broker 地址                            |
| KAFKA_INTEGRATION_SECURITY_ENABLED                                  | 安全专项必须为 `true`；普通明文测试默认 `false` |
| KAFKA_INTEGRATION_CA_FILE                                           | 测试 broker 的 PEM 信任根路径                   |
| KAFKA_INTEGRATION_SASL_MECHANISM                                    | `scram-sha-512` 或 `scram-sha-256`              |
| KAFKA_INTEGRATION_USERNAME / KAFKA_INTEGRATION_PASSWORD             | 受限应用账号及密码                              |
| KAFKA_INTEGRATION_ADMIN_USERNAME / KAFKA_INTEGRATION_ADMIN_PASSWORD | 不同的资源管理账号及密码                        |

安全开启时上述配置必须完整，两个账号必须不同；关闭时残留安全配置拒绝执行。测试配置显式清空生产 TLS/mTLS/SASL 变量，避免 ConfigService 从宿主机环境继承另一套凭证。不要输出完整配置或把临时密码写入仓库。

## 专用 broker 的约束

应用账号仅对 `linji-it-`、`linji-shutdown-`、`linji-security-` 三种前缀拥有 topic READ/WRITE 和 group READ；这些权限隐含对应 DESCRIBE。没有 topic CREATE/DELETE、集群授权管理或其他业务前缀权限。资源管理账号负责预先建 topic、扩容和最终删除。关闭自动建 topic 与默认放行 ACL；不得为让测试通过而授予应用账号超级权限。

TLS 必须保持服务端证书信任链和主机名检查。安全专项分别验证 SCRAM-SHA-512/256 成功写入、错误密码/不存在账号拒绝、无信任根/主机名不匹配拒绝、匿名 TLS 客户端拒绝，以及越界 topic/group 和管理操作拒绝。越权写入后由管理账号核对未产生记录，越权创建/删除后核对资源状态；匿名拒绝后核对 broker 仍可正常服务已认证管理账号。

本机复用前一阶段的便携 QEMU / Alpine / JDK / Kafka 运行时，在 D 盘新建覆盖磁盘和 broker 数据目录。宿主机仅转发 SASL_SSL 客户端端口到 `127.0.0.1`，控制入口独立使用随机令牌。guest 的内部 broker/controller 明文监听绑定 guest 回环地址，ANONYMOUS 超级身份只服务这一隔离测试拓扑；客户端入口必须先完成 SCRAM，不允许匿名请求。这套单节点测试内部配置不得用作生产部署模板。

测试证书来自[公开夹具](../../test/fixtures/kafka-tls/README.md)，临时 PKCS12 和随机密码仅在 D 盘准备并传入本次 guest，准备完成后清除宿主机临时文件；不包含真实环境证书或密钥。broker 强制中断恢复期间使用本次同一磁盘和认证配置。基础运行时磁盘只读复用，运行前后比较摘要；禁止改写此前成功副本或借用 Docker 的 WSL 发行版。

## 验收边界

必须同时取得安全专项、原有十项真实集成无跳过、24 项迁移/双 seed/前后结构校验，以及最终业务测试记录、非内部 topics/groups 清空。还需确认 guest、文件/恢复服务、专用 PostgreSQL 退出和端口关闭，才能标记本轮通过。环境准备失败和业务断言失败单独保留，不累计为成功次数。

即使通过，也只证明隔离环境的单 broker TLS/SCRAM/ACL 与应用路径；不证明生产证书签发/轮换、多 broker 复制选主、跨机网络、容器或远程 CI。Embedding 继续使用固定 1024 维测试向量，真实模型与 Embedding 供应商仍待验。浏览器、原生设备和既有待确认业务协议保持原状态。

## 已发现的测试观察差异

KafkaJS 2.2.4 在 topic 元数据权限失败时将协议码 29 包装到 cause；断言检查有限深度的错误链，仍要求确切协议码。FindCoordinator 路径的 brokerPool.withBroker 会吞掉底层错误并返回 null，最终为 KafkaJSGroupCoordinatorNotFound；group 负例通过自定义 logCreator 仅收集指定 group 的协调器错误码，必须包含 30，同时要求外层异常匹配且管理员核对 group 未创建。通用连接异常不能满足这些断言，不记录完整 debug 文本。

首次真实安全专项 10 项通过、2 项失败；修正 topic 错误链及 group 元数据准备后 11 项通过、1 项仍因 KafkaJS 丢弃协议码失败。原日志分别保留于 `D:/linji-kafka-secure/20261104/run-111229` 和 `run-111605`。更早的 Python 兼容、脚本换行、路径和模块导入准备失败未进入安全场景，不算业务失败或通过。

## 真实运行结果

最终运行 `D:/linji-kafka-secure/20261104/run-111902`：12 项安全专项用时 6.76 秒，十项原有集成用时 304.86 秒；应用账号仅获九条前缀 ACL，未调整生产重试、会话时间、授权配置或业务断言。实际 broker 为 Kafka 4.1.1，PostgreSQL 17.11 / pgvector 0.8.1；24 项迁移、双 seed、测试前后结构校验通过。

最终 User=1，ProjectKnowledge / RagDocument / OutboxEvent / ConsumedEvent 均为 0，非内部 topic 和 group 为空。guest 正常关机退出码 0，基础磁盘摘要保持；broker 58889、文件入口 58890、恢复入口 51591、PostgreSQL 49658 均经独立 socket 探针确认拒绝连接。初始化密码、PostgreSQL pid 和宿主机临时安全文件已清除。清理证明核对 59 个消息模块/数据库/锁文件保持，与此前生产消息实现一致。

本轮保留工作区另已存在的 DeepSeek 配置与探针变更，最终工程复验按当前源码执行；本轮 Kafka 向量仍为替身，不借用对话模型冒烟结果声明真实 RAG 通过。

三仓最终新副本位于 `D:/linji-kafka-secure/20261104/final/validated`，均先核对源码清单再独立冻结安装，仅复用各自store，25条工程命令全部退出0。Backend 1323单测/20源码工具与173HTTP框架、build/编译OpenAPI通过；Web3045业务/20源码工具/20发布工具、两次强制无缓存应用构建和standalone检查通过；App1217业务/20源码工具/10产物工具、Doctor20/20、iOS/Android/Web导出及88文件封存迁移校验通过。产物仍为JavaScript bundle，nativeInstallable=false。完整858项数据库套件为此前字段阶段证据，本轮只重跑真实Kafka安全与数据库集成。
