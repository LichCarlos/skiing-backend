# Kafka TLS 与 SASL 连接配置

2026-11-04 更新：[独立真实broker安全验收](kafka-secure-broker-validation.md)的12项TLS/SCRAM/ACL与原有十项消息集成已通过；下文2026-11-02未执行真实安全连接的说明仅指当时范围。生产集群、证书轮换及多broker验收继续保留。

日期：2026-11-02。KafkaJS 锁定版本 2.2.4；查阅[官方客户端配置](https://kafka.js.org/docs/configuration)，并核对本仓已安装版本的 KafkaConfig 类型、socketFactory、TLS 和认证实现。只修改 Backend Infrastructure 与环境模板，没有新增依赖、HTTP 协议、事件字段或数据库迁移。

## 实现

[共用配置函数](../../src/modules/integration-events/infrastructure/kafka-client-config.ts)供[生产者](../../src/modules/integration-events/infrastructure/kafka-event.publisher.ts)和[消费者](../../src/modules/integration-events/infrastructure/kafka-event.consumer.ts)在构造 KafkaJS 客户端前调用。原 broker、topic、group、事件序列化、消费者重连和 Outbox/Inbox 语义保持。

| 变量                                      | 规则                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| KAFKA_BROKERS                             | 保留逗号列表及 trim；默认 localhost:9092，空列表拒绝                            |
| KAFKA_TLS_ENABLED                         | 严格 true/false；默认 false，保持本地明文 broker 可用                           |
| KAFKA_TLS_CA_FILE                         | 可空，容器内只读 PEM 证书包路径；空值使用 Node 默认信任根，非空则使用指定信任包 |
| KAFKA_TLS_CERT_FILE / KAFKA_TLS_KEY_FILE  | 可空；双向 TLS 证书/私钥必须成对，使用未加密 PEM 私钥                           |
| KAFKA_SASL_MECHANISM                      | 可空，支持 plain、scram-sha-256、scram-sha-512；其他值拒绝                      |
| KAFKA_SASL_USERNAME / KAFKA_SASL_PASSWORD | 配置机制后必须同时非空白；原始凭证字节保留，不 trim                             |

TLS 启用后固定 rejectUnauthorized=true、最低 TLSv1.2，不提供跳过证书/主机名校验开关。私有 CA 文件检查每张 X509 证书；双向 TLS 显式检查证书与私钥匹配，再创建 Node SecureContext。未启用 TLS 却配置证书文件、单边证书、无机制凭证和无 TLS 的 SASL 均在创建网络连接前报错。配置错误消息仅说明变量/类别，不附带路径、文件内容、凭证或原始 OpenSSL 错误；不要在运维中打印完整 ConfigService/KafkaConfig。

首轮测试发现不同算法的证书/私钥组合在 createSecureContext 中可能不会立即失败；新增 X509Certificate.checkPrivateKey 后专项通过。原失败日志 kafka-security-focused.log 保留。这不替代连接时的证书有效期、主机名和信任链校验；这些仍由 Node TLS 执行。

## 运行与挂载

[本地模板](../../.env.example)保持 TLS=false、SASL 留空；[生产模板](../../infra/backend.production.env.example)改为 TLS=true 和 SCRAM-SHA-512 占位，需按真实集群替换。密码由私有环境文件/部署密钥注入，前端无需任何 Kafka 配置。使用 Node 默认信任根时无需挂载证书；私有 CA/mTLS 需在环境自己的 Compose override 中配置只读路径，例如：

```yaml
services:
  api:
    volumes:
      - /absolute/private/kafka:/run/secrets/kafka:ro
```

对应环境变量使用容器内路径 `/run/secrets/kafka/ca.pem` 等。UID node 必须可读文件及父目录，勿复制进 Docker 镜像或提交真实私钥。只挂载所需文件，运行工具镜像若确实要创建 Kafka 客户端也应配同样挂载。不要把宿主机绝对路径直接作为容器内路径。

凭证和 PEM 在构造客户端时读取；当前无热重载，轮换需按部署流程有序替换实例，结合已有排空规则处理在途消息。OAuth、AWS IAM、加密 PEM 私钥、KDC/Kerberos 和任意自定义认证插件未接入。生产 SASL 用户/topic ACL、证书签发、轮换、到期监控及多 broker 安全配置仍由实际环境验收。

## 验证范围

[配置专项](../../src/modules/integration-events/infrastructure/kafka-client-config.spec.ts)验证默认值、三种机制、TLS 强校验、PEM/凭证完整性和错误脱敏；两个既有客户端测试补充传参核对。

[回环传输专项](../../src/modules/integration-events/infrastructure/kafka-tls-transport.spec.ts)使用真实 KafkaJS、Node TLS socket 和固定测试证书。服务端仅实现 ApiVersions、SASL handshake/PLAIN 最小协议，验证可信服务端、非信任根拒绝、双向 TLS、缺失客户端证书拒绝和正确/错误 PLAIN 凭证。它不是 Kafka broker，不验证消息投递、消费者重放、SCRAM 挑战响应或真实集群 ACL。固定证书/公开测试私钥的用途见[夹具说明](../../test/fixtures/kafka-tls/README.md)。

四文件专项 37 项通过。Backend 冻结安装、lint/typecheck、135 文件 / 1108 单测、6 文件 / 130 HTTP与框架测试及 build 通过。编译后 OpenAPI exporter 在数据库/Kafka 不可达且两个消息开关启用时通过，契约仍为 1.50.0 / 143 操作，SHA-256 保持 `adaa39927fab990393b5d9213cf81eebea2f500d456aa93deefa006cb79d40c0`。日志 kafka-security-install/check-final/e2e/build/openapi.log；首轮类型失败保留在 kafka-security-check.log。

Docker 仍按用户决定不重启，真实 Kafka TLS/SCRAM、真实数据库复验和容器验收未执行。此前明文 Kafka 恢复专项属于历史证据，不能当作本次安全传输验收。前端配套工程复验在本轮阶段记录中单独列出；没有 Web/App 业务协议变动。

额外启用 TLS/SCRAM-SHA-512 测试配置、保持依赖不可达和消息开关启用时，编译后 exporter 仍通过；kafka-security-openapi-secure.log 保留。这只验证安全配置可以装配且契约导出不触发连接，不是 SCRAM 网络认证证据。

前端配套复验已结束：Web 独立冻结安装、完整 1459 项与两个应用构建通过（缓存命中）；App 独立冻结安装、56 文件 / 998 项、Doctor 20/20 和三平台导出通过，产物 `D:/linji-kafka-security/20261102/app-export`。各仓保留 kafka-security- 日志；实际浏览器/原生设备验收仍待完成。
