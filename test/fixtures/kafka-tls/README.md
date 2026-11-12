# Kafka TLS 测试证书

本目录只用于回环 TLS 测试及独立隔离的本机 broker 验收，不得用于业务运行或发布。证书中的 CA 名称明确包含 TEST ONLY；2020–2100 的有效期仅避免夹具随当前日期过期。CA 私钥没有保存，broker-key.pem 是公开测试私钥，不是任何环境的凭证。

ca.pem 为测试信任根，broker-cert.pem 由它签发，SAN 仅包含 localhost 和 127.0.0.1，扩展用途为 serverAuth/clientAuth。测试用同一身份演示双向 TLS，生产必须为服务分别签发身份。它们由 Python cryptography 临时生成后固定归档，运行测试不需要 Python、OpenSSL 命令或外部网络。

回环服务只实现 ApiVersions 和 SASL PLAIN 最小认证协议，验证 KafkaJS 的 TLS/PLAIN 传输行为，不代表真实 Kafka 集群、SCRAM、消费重放或生产证书轮换已验收。

另行执行的[真实 broker 安全专项](../../../docs/engineering/kafka-secure-broker-validation.md)可将这些公开测试文件转换为临时 PKCS12，供仅转发宿主回环端口的专用 Kafka 使用。转换工具与临时密码在仓库外，生产实现仍读取 PEM；最小协议夹具不依赖转换工具。两个测试层级的证据须分别记录。
