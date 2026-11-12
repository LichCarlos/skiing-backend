# 2026-11-05服务器部署

用户授权部署至47.109.181.69，使用已有SSH配置。API为`https://lichcarlos.top/snow-api/api/v1`，NestJS systemd服务`linji-api`，运行目录`/opt/linji/releases/20261105/backend`，配置`/opt/linji/private/backend.env`，日志用`journalctl -u linji-api`读取。源码未提交或推送。

独立Podman容器linji-postgres运行PostgreSQL17/pgvector，回环15432；25迁移、seed、dbverify与Linux生产构建通过。原有5432数据库和其他项目保留。专用linji-postgres.service负责该容器开机启动，没有启用共享podman-restart。数据目录`/opt/linji/data/postgres`，数据库备份须放私有位置。

linji-kafka运行Kafka4.1.1单节点KRaft，回环19092/19093；已创建linji.integration-events，启用Outbox与consumer。linji-minio使用私有桶linji-snow-assets，回环19000，HTTPS签名地址通过网关保留桶路径和Host。linji-clamav使用1.4.6及标准签名库，回环13310，daily timer更新。真实上传/扫描/私有存储/HTTPS读回和无签名403通过，测试资产已删除。

服务器约2GB内存且与其他项目共存，BGE-M3在本机Windows运行，服务器回环19180经SSH反向隧道连接本机回环19181。配置`/opt/linji/private/embedding.env`已合并backend.env；模型bge-m3-q8-950f4a8e5e19、1024维、CLS/L2，既有模型SHA256为950f4a8e5e19477a6d3c26d2f162233c20002c601f75e4b002e3239997821167。DeepSeek使用已有服务端deepseek-flash配置。

本机Windows任务LinjiSnow-LocalEmbedding负责登录启动，监督脚本`D:/linji-local/20261105/local-embedding.mjs`负责模型/隧道重连。本机休眠、关机、断网会影响语义RAG，不能把它视为服务器独立模型部署；恢复后后台重试失败索引。2048上下文需在上线长业务语料前核对分块token预算。

线上临时知识发布→Outbox/Kafka/Inbox→BGE-M3/pgvector→DeepSeek HTTPS SSE及引用→会话持久化通过；测试知识撤回软删除，测试会话软删除。证据在D:/linji-local/20261105下auth-live-results.json、storage-live-results.json、embedding-live-results.json、rag-live-results.json；没有暴露密钥。首次测试来源类型选择器错误及其清理结果保留。

API18080目前监听全地址，业务入口经Nginx；尚未核对云安全组。证书至2026-12-10；监控、异机自动备份、容量、全部管理流程及灾备尚未验收。健康接口仅代表存活。初始账号admin随机密码在本机private/admin-initial.txt，不在仓库。
