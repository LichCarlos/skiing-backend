# DeepSeek 与真实 Embedding 接入计划

2026-11-04 HTTP/AI 脱敏故障诊断：流前/流后故障已接入安全分类和服务端trace，本地真实上游503及超时通过；见[工程说明](failure-diagnostics.md)。前轮两次500根因未知，本轮没有重新调用收费模型。

日期：2026-11-04。当前补充真实 BGE-M3 与合成语料 HTTP RAG 验收。范围为现有 NestJS AI 适配器、本地配置与真实供应商验收；Web/App 继续调用后端已有 HTTP/SSE 接口，不持有供应商密钥。

## 当前结果

| 项目               | 状态         | 证据或剩余条件                                                                                                                          |
| ------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| DeepSeek 官方认证  | 通过         | 官方 `GET /models` 返回 200；当前账号可见 `deepseek-flash`、`deepseek-v4-pro`                                                           |
| Flash 实际流式调用 | 通过         | 项目现有 `OpenAiCompatibleChatModelProvider` 调用官方接口成功，收到正文和 `[DONE]`；本次 5 个正文片段、11 字符、1281 ms，仅为单次冒烟   |
| 模型名称           | 已修正       | API 使用 `deepseek-flash`；官方说明其对应 DeepSeek-V4.1-Flash-1017；`deepseek-v4.1-flash` 不是本次账号清单中的 ID                       |
| 本地密钥配置       | 已创建       | 密钥仅在本仓 Git 忽略的 `.env`；另一段用户确认同属 DeepSeek 的凭证未转发给第三方，也未猜作 Embedding 密钥                               |
| 真实 Embedding     | 隔离验收通过 | llama.cpp b12097 + 固定修订 BGE-M3 Q8，1024 维 CLS/L2，正式适配器三文本语义检查及 39 次专项调用通过；临时进程已停止                     |
| 真实 HTTP RAG      | 合成专项通过 | 先前 28 项/20 问题；后续项目知识实际 Outbox/Kafka/真实模型组合 9 项及 broker 进程中断恢复通过；详见组合验收说明，生产回填和长期运行待验 |
| 官网/App 实际交互  | 待验收       | 本次没有启动页面服务、运行浏览器或原生设备                                                                                              |

本机原来没有 `backend/.env`，本次新建文件只保存 AI 设置。它不包含数据库、JWT、存储等完整应用启动配置。对话适配器通过不表示整套应用已经运行。既有替身与 Linux Kafka 集成证据保留原有范围。

## 采用的路线

```text
Next.js / Expo
      │ 原有登录、HTTP 与 SSE
      ▼
NestJS 会话应用服务
      │ 用户权限与来源校验
      ├── Embedding：BGE-M3，1024 维
      │        ▼
      │   PostgreSQL / pgvector 授权检索
      │        ▼
      └── DeepSeek deepseek-flash 流式生成与引用返回

业务变更 → 同事务 Outbox → Kafka / Inbox → 分块与 BGE-M3 → pgvector
```

对话和向量配置相互独立。向量入库与提问必须使用同一模型和同一模型修订；仅有相同维度不足以混用。现有数据库固定 `vector(1024)`，本阶段沿用 BGE-M3，不调整 schema、migration 或业务 API。

资料继续使用已接入的雪场、滑雪文章、项目知识、审核公开动态和显式公开字典。禁止通过导出整库绕过来源与权限校验；密码、会话令牌、密钥和无权访问的业务数据不作为模型上下文。

## 第一阶段：DeepSeek 配置与冒烟（已执行）

本仓 `.env` 的非敏感设置：

```dotenv
CHAT_MODEL_BASE_URL=https://api.deepseek.com
CHAT_MODEL_NAME=deepseek-flash
CHAT_MODEL_TIMEOUT_MS=120000
CHAT_MODEL_THINKING=disabled
CHAT_MODEL_MAX_TOKENS=2048
```

`CHAT_MODEL_API_KEY` 已本地配置，不写入本文、测试、前端或证据文件。

`CHAT_MODEL_THINKING` 是可选 DeepSeek 扩展，值为 `enabled` 或 `disabled`；为空时不发送该字段，便于其他 OpenAI-compatible 服务继续使用适配器。配置 `disabled` 适合本项目基于检索资料的交互问答。仅正文进入客户端 SSE，不输出推理字段。

`CHAT_MODEL_MAX_TOKENS` 是可选正整数。应用未显式指定输出上限时使用该值；验收探针使用更小的 256 token 上限。原有取消、超时、错误脱敏和不自动重放付费请求的行为保持。

```powershell
cd E:\desktop\lishiqi\backend
pnpm ai:verify --help
pnpm ai:verify --chat
```

命令先核对模型清单，再通过正式适配器发送固定合成文本；真实调用可能产生费用。探针不访问数据库、不传用户资料、不启动应用服务。只输出状态、模型名、耗时、片段数等信息，不输出密钥、供应商错误正文或完整回答。

## 第二阶段：BGE-M3 隔离服务（已验收，未常驻部署）

实际采用 llama.cpp b12097 官方 CPU 运行时与固定修订的 BGE-M3 Q8 GGUF；索引和提问模型标识均为 `bge-m3-q8-950f4a8e5e19`。下载摘要、CLS/L2 参数、1024 维、回环鉴权、外部输出目录、复现命令和容量限制统一见 [真实 RAG 验收](real-rag-validation.md)。本次没有安装 Ollama、系统服务或容器，没有给工作区 `.env` 写入临时 Embedding 地址。临时服务已停止，生产须另行部署并按实际批次/token/并发配置容量。

`pnpm ai:verify --embedding` 用三条合成中文文本核对格式和语义；`pnpm test:rag-live` 在专用数据库中执行真实 HTTP/RAG 专项。两者均明确要求配置，失败不静默跳过。模型修订、量化、池化、归一化改变必须重新评估并重建索引，不能仅按相同维度混用。

## 第三阶段：生产环境、业务语料与持续索引（待执行）

1. 在本地环境变量中补齐数据库、认证、存储、前端 Origin 等现有必需设置，使用专用验收环境。先核验数据库连接目标，应用现有 migration、seed 和结构校验，不对共享业务库运行清空脚本。
2. 启动可用的 PostgreSQL/pgvector 和 Kafka，确认 API、worker、命令行都使用同一 BGE-M3 模型配置。本次未修改此前的服务启停安排。
3. 在管理端创建或选择已发布且允许检索的雪场、滑雪知识和项目知识。保持草稿、撤回、人工停用与无权资料的过滤。
4. 首次接入真实模型或切换模型时执行显式回填：

   ```powershell
   pnpm rag:reindex --source all --batch-size 16
   ```

   该命令连接数据库、写入索引，并可能调用付费向量服务。按管理端来源状态核对失败项，避免将失败或零条可检索资料误认为就绪。

5. 在正常后台运行配置中启用现有 `OUTBOX_DISPATCH_ENABLED=true` 和 `KAFKA_CONSUMER_ENABLED=true`，验证业务变更持续更新索引。一次性回填不能替代后续事件消费。
6. 用正常登录账号调用已有会话与 SSE 接口，核对回答引用、消息持久化、刷新恢复和重复幂等键不重复生成；随后在官网/App 实际交互中验收。

具体回填和并发来源规则见 [RAG 来源与回填](rag-source-visibility.md)、[来源实时校验](rag-live-evidence.md)和 [AI 会话](ai-conversations.md)。本次没有新增接口、修改授权语义或执行目标库回填。

## 可用性验收门槛

| 验收         | 通过条件                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| 供应商连通   | `--all` 两项通过；实际模型和模型修订有记录                                                                 |
| 真实检索     | 至少准备 20 个问题，覆盖雪场比较、初学安全、平台规则和多轮追问；人工记录预期来源、实际来源、回答与失败原因 |
| 权限与时效   | 游客不能对话；账号隔离；草稿和无权内容不可检索；下架、撤权、人工停用后不能继续暴露旧引用                   |
| 无资料与故障 | 无证据按现有规则拒答；401/402/429/超时和断流显示可恢复错误；未完整生成的回答不作为完整回复保存             |
| 增量更新     | 管理端修改来源后，经 Outbox/Kafka 更新真实向量；重复事件保持幂等                                           |
| 页面实际使用 | 官网、Expo Web 和目标原生设备完成登录、提问、流式显示、查看引用、切换页面和恢复会话                        |
| 运维         | 监测供应商费用/限额、延迟、错误率和索引失败；明确正常启动、停止与恢复命令                                  |

本轮已补齐隔离合成语料下的真实 Embedding、pgvector、认证 HTTP/SSE 和对话验收。它不证明业务语料质量、所有来源的长期索引、目标页面/设备或生产部署已完成。项目知识实际消息组合的 9 项结果见 [组合验收](kafka-real-rag-validation.md)。

早期第二次联合探针结果见 [2026-11-04 实际供应商报告](../validation/deepseek-provider-20261104.json)：对话通过，Embedding 为 `not_configured`，联合命令按约定返回退出码 1。两次对话探针均使用固定合成文本；未向供应商发送实际用户资料。

早期供应商阶段工程验证：新增 26 项回归，涉及模型默认值、思考/输出配置、模型可用性、向量格式与语义比较、错误脱敏和联合报告。相关 4 个测试文件共 78 项全部通过；修改文件的类型感知 lint、后端完整 TypeScript 检查和 Nest 生产构建通过。三仓 OpenAPI 的 SHA-256 保持一致，未改 API 契约。该早期阶段未重跑全量数据库和 Web/App 测试；本轮三仓最终独立检查与构建/导出见 [真实 RAG 证据](../validation/real-rag-20261104.json)。完整数据库 858 项套件本轮未重跑。

## 官方依据

以下资料于 2026-11-04 查阅，模型可用性另由当前账号实际清单核对：

- [DeepSeek 模型与价格](https://api-docs.deepseek.com/quick_start/pricing)
- [DeepSeek 模型列表](https://api-docs.deepseek.com/api/list-models)
- [DeepSeek 思考模式](https://api-docs.deepseek.com/guides/thinking_mode)
- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion)
- [BGE-M3 模型说明](https://huggingface.co/BAAI/bge-m3)
- [Ollama BGE-M3](https://ollama.com/library/bge-m3)
- [Ollama OpenAI 兼容接口](https://docs.ollama.com/api/openai-compatibility)

验收入口：[verify-model-providers.ts](../../scripts/verify-model-providers.ts)。本次不要求 Web/App 更新 OpenAPI；业务契约维持 1.51.1 / 143 operations。
