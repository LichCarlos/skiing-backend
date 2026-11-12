# 真实 BGE-M3 与 DeepSeek 的 RAG 验收

2026-11-04 后续组合专项：项目知识已通过真实管理 API → Outbox → TLS/SCRAM Kafka → BGE-M3 → pgvector → DeepSeek 的 9 项验收，包含 broker 进程中断恢复；见[组合说明](kafka-real-rag-validation.md)。下文 28 项/20 个合成问题仍保持原阶段范围与计数，生产常驻及所有来源长期运行待验。

日期：2026-11-04。负责人：Backend。状态：真实 Embedding 冒烟及 28 项真实 HTTP/RAG 专项全部通过，三仓独立工程复验与清理完成。契约保持 OpenAPI 1.51.1 / 143 操作，数据库保持 24 项迁移和 `vector(1024)`。

## 模型与运行时

本机使用隔离的 CPU Embedding 服务，继续通过既有 OpenAI-compatible `/v1/embeddings` 接入，不给 Web/App 增加供应商凭证或连接方式。原生运行时、模型、临时数据库和日志均在 `D:/linji-real-rag/20261104`，没有安装系统服务或启动 Docker。

| 项目               | 固定值与依据                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| CPU 运行时         | llama.cpp b12097，版本输出 `0.8.0-dev` / commit `b97627967`，Windows x64 CPU 官方发布包                 |
| 运行时 ZIP SHA-256 | `2a48f973521cb76fdf8123b12c62a89ad59b01372b98405123dd4e7114e1ae27`，与 GitHub release asset digest 匹配 |
| 模型               | GPUStack 转换的 BAAI BGE-M3，`bge-m3-Q8_0.gguf`，Q8 量化，634,553,760 字节                              |
| 模型仓库修订       | `gpustack/bge-m3-GGUF` / `2d48f1737679ad900d5c26c5aad5410e9c70fdca`                                     |
| 模型 SHA-256       | `950f4a8e5e19477a6d3c26d2f162233c20002c601f75e4b002e3239997821167`，与固定修订 LFS 对象摘要匹配         |
| 本次模型 ID        | `bge-m3-q8-950f4a8e5e19`；索引与提问必须一致，不与其他 BGE-M3 修订或精度混用                            |
| 输出               | CLS 池化、L2 归一化、1024 维稠密向量；不使用稀疏或多向量分支                                            |
| 本机配置           | 2 CPU 线程、1 个 slot、context/batch/ubatch 均为 2048，监听 `127.0.0.1` 随机端口                        |
| 认证               | 随机 256 位 API key 通过进程环境注入；未提供 key 的 Embedding 请求必须返回 401                          |

原模型的 `1_Pooling/config.json` 明确启用 CLS，不能把平均池化当作同一向量空间。Q8 是本机受限内存下的验收选择，不能据此声称与 FP16 检索精度完全相同。模型 SHA、运行时版本、池化、归一化发生变化均应重新索引并评估。

官方运行时来自 [llama.cpp b12097](https://github.com/ggml-org/llama.cpp/releases/tag/b12097)，参数及接口核对[同版本服务端说明](https://github.com/ggml-org/llama.cpp/blob/b12097/tools/server/README.md)。模型来自[固定修订](https://huggingface.co/gpustack/bge-m3-GGUF/tree/2d48f1737679ad900d5c26c5aad5410e9c70fdca)，原始模型及池化依据见 [BAAI BGE-M3](https://huggingface.co/BAAI/bge-m3)。查阅与实际摘要校验日期为 2026-11-04。

## 复现方式

在已下载、校验的独立运行时目录启动专用服务，API key 应由本地私有环境注入，不写入命令行、仓库或日志：

```powershell
$env:LLAMA_API_KEY='<本地随机凭证>'
& '<runtime>/llama-server.exe' `
  --model '<models>/bge-m3-Q8_0.gguf' `
  --alias bge-m3-q8-950f4a8e5e19 `
  --embedding --pooling cls --embd-normalize 2 `
  --host 127.0.0.1 --port 11435 `
  --threads 2 --threads-batch 2 --parallel 1 `
  --ctx-size 2048 --batch-size 2048 --ubatch-size 2048 --no-webui
```

后端进程、索引 worker 和回填命令使用同一配置：

```dotenv
EMBEDDING_BASE_URL=http://127.0.0.1:11435/v1
EMBEDDING_MODEL=bge-m3-q8-950f4a8e5e19
EMBEDDING_TIMEOUT_MS=120000
```

`EMBEDDING_API_KEY` 对应服务启动时的随机凭证，单独保存在私有环境。远程部署需要实际 TLS/鉴权入口及私有网络配置，本地回环示例不作为远程暴露方案。此 2048 token 参数只覆盖本次短文本验收；现有索引单批最多 32 块、每块最多 1200 Unicode 字符，生产服务必须按实际 token 长度及并发配置更大的容量或供应商批处理限制，不能将本次参数复制为容量承诺。

先执行 `pnpm ai:verify --embedding`，再按目标环境配置执行 [rag:reindex](rag-source-visibility.md)。本次隔离测试不会改写工作区 `.env`，不会对业务数据库回填。停止测试服务后不能把本次临时地址当作持久在线服务。

## 专项内容

`pnpm test:rag-live` 是独立入口，不属于默认单测或普通数据库测试，也不会在缺配置时静默跳过。必须显式设置 `LINJI_REAL_RAG_CONFIRM=linji_real_rag_validation`，`DATABASE_URL` 必须指向回环专用数据库 `linji_real_rag_validation`，并提供真实 Chat/Embedding 配置与 `LINJI_REAL_RAG_RUN` 输出目录。该目录必须是仓库外绝对路径，解析符号链接后仍不得位于仓库内；不依赖作者机器的 D 盘目录。该入口会调用真实模型，可能产生对话费用；仅使用[固定合成资料与问题](../../test/fixtures/rag-live-corpus.ts)，不得替换成实际账号或私有资料。

先创建仅供本专项使用的空 PostgreSQL 数据库（已安装 pgvector 扩展），按本仓 `.env.example` 提供 `DATABASE_URL`、`INITIAL_ADMIN_ACCOUNT/PASSWORD`、JWT 与登录限流秘密。依次执行 `pnpm db:generate`、`pnpm db:deploy`、`pnpm db:seed`、`pnpm db:verify`；仅保留一个 seed 管理员及初始角色权限，不混入业务记录。测试进程设置 `KAFKA_CONSUMER_ENABLED=false`、`OUTBOX_DISPATCH_ENABLED=false`，使用同一真实模型配置，显式设置上述确认值和输出目录后运行 `pnpm test:rag-live`。本次 Chat 输出上限 512 token。完成后再次执行 `pnpm db:verify` 并检查测试记录清理；服务由启动它的进程负责停止。不要将业务数据库改名后交给本专项。

[真实专项](../../test/rag-real-providers.live-spec.ts)装配实际认证、AI 模块、Prisma/pgvector 和两个正式供应商适配器；不覆盖 provider。透明计数器调用原始方法，验证幂等重放不再次执行收费请求。雪场、滑雪知识、项目规则共十份公开资料，另写入四份草稿/私有/过期/人工停用的毒化索引，测试真实 SQL 在检索前排除它们。

二十个预先标注的问题覆盖价格、亲子、营业时间、夜场、雪场比较、头盔、减速、穿衣、求助、账号/审核/收益/AI 规则及带历史问题的追问。逐项要求预期来源出现在 top-5，同时排除所有不可见来源，记录问题、预期/实际来源、相似度与通过情况。这是小型合成召回冒烟，不替代业务语料大规模召回率和人工质量评估。

HTTP 路径使用实际登录签发的 Bearer JWT，覆盖匿名拒绝、真实 DeepSeek 流式回答与来源/持久化、重复幂等键不重复请求、真实多轮追问、另一账号 404、雪场下架后旧向量立即不可检索，以及无资料时确定性拒答且不调用 Chat。知识更新还直接执行现有生产事件 handler，实际写入新向量并验证 Inbox 重复事件不重复调用 Embedding。这个 handler 验收不包含 Kafka 投递；真实 Kafka TLS/SCRAM/ACL 的二十二项验收在[独立记录](kafka-secure-broker-validation.md)，不能将两个阶段合并宣称完整事件到模型链已验。

输出仅记录合成题目、回答、来源、计数与模型标识，不记录凭证或完整向量。测试完成后删除本次用户、会话、业务资料、索引和 Inbox；专用数据库与 Embedding 进程退出后核对端口关闭。

## 当前已取得的证据

真实 Embedding 冒烟使用项目正式适配器，三条合成中文输入均返回 1024 维：相关相似度 `0.7963806931`，无关相似度 `0.2442040648`；单次请求约 438 ms。无凭证请求 401，测试进程已停止。原始日志与模型摘要保存于 `D:/linji-real-rag/20261104/embedding-smoke.log` 及对应 run 目录。

最终新副本运行 `run-20261104040409368`：28/28、零跳过，Vitest 命令总耗时 19.11 秒；20 个预标注问题全部命中预期来源，实际 Embedding 调用 39 次、DeepSeek 调用 2 次。首问返回合成松林日票 180 元，追问返回 17:00 结束营业，均含资料引用；相同幂等键重放不增加模型调用。首个诊断副本亦 28/28，最终副本另验证了可移植输出目录守卫，两次运行分别保留，不合并计数。

三仓在 D 盘新副本分别冻结安装/check：Backend 1323 单测、20 源码工具、173 HTTP 框架及构建/编译 OpenAPI；Web 3045 业务、20 源码/20 发布工具、官网/Admin 双无缓存构建和 standalone 校验；App 1217 业务、20 源码/10 产物工具、Doctor 20/20、三平台导出及 88 文件封存迁移均通过。24 迁移/双 seed/前后结构校验通过，临时模型与数据库停止、两端口关闭、所列业务/索引/会话/事件测试记录归零（保留一个 seed 管理员）。契约 1.51.1 / 143 操作及生产源码、schema、锁文件保持；完整 858 项数据库套件本轮未重跑。

本轮新增合成语料、opt-in 专项及脚本；497 个生产源码/schema/锁文件与前一 Kafka 阶段逐一比对保持。初期类型检查失败日志保留，修正后才执行最终验收。摘要见[本仓证据](../validation/real-rag-20261104.json)，完整原始日志位于 `D:/linji-real-rag/20261104`，模型与运行时不随仓库复制。

生产模型常驻与容量、真实业务语料/人工质量及持续 Kafka 索引、浏览器/Expo Web/原生设备与签名包、生产存储/集群/容器/远程 CI 仍待完成；D-49/D-50/D-09 维持待决。未启动/重启 Docker，未重试此前被拒绝的操作，项目整体尚未完成。
