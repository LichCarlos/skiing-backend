# 首次公开推送前 README 归档

归档日期：2026-11-12。下文保留原阶段叙述，当前安装、版本与状态以仓库根 README 为准。

---

# 凛迹雪客 Backend

2026-11-07 13:04 [个人中心笔记收藏 API 已上线](docs/engineering/member-center-20261107.md)：OpenAPI 1.54.0，第 27 个增量迁移；用户笔记沿用社区审核，新增 dynamic 收藏且兼容移动端默认两类收藏。1525 单测、178 HTTP、7 项真实 PostgreSQL 收藏及克隆实际发布审核流程通过，正式内容数量保持。[验收报告](docs/validation/member-center-20261107.json)。

2026-11-06 最新线上发布：[富文本API生产部署](docs/engineering/markdown-release-20261106.md)。API已部署，26迁移与数据库校验通过，原内容和权限保留；13项克隆库真实HTTP/扫描/图片/审核验收通过，无合成生产内容。OpenAPI1.53.0。下方“未部署”为历史阶段。

2026-11-06 最新本地增量：[Tiptap/Markdown编辑与阅读](docs/engineering/markdown-editor.md)。包含社区编辑、Asset正文图片与受控链接，OpenAPI1.53.0。**未部署、未更新APK**；以下线上记录属于此前版本。

2026-11-05部署增量：[服务器与本机Embedding](docs/engineering/server-deployment.md)。线上API为https://lichcarlos.top/snow-api/api/v1；独立PG、Kafka、MinIO和标准ClamAV已运行，真实HTTPS认证/存储及DeepSeek RAG引用链通过。以下旧阶段“未部署”按原阶段理解。

2026-11-05 收尾：五项闭环实现已交付。Backend1494单测/177框架HTTP/865真实DB、8项真实服务场景通过；Web3062业务测试及双生产构建通过；App1238测试、三平台导出及4项Android实操通过。完整浏览器、iOS/真机与新增依赖真实Kafka仍待验；构建和API测试不代替完整三端点击验收。 详见[本轮报告](docs/validation/business-closure-20261105.json)。

2026-11-05 当前基线 **OpenAPI 1.52.0 / 151 操作**。商家资料由身份模块管理，新增公开业务查询与AI受限计划执行，索引sourceState v2/依赖fanout和两类清理命令均已接入。25个迁移含资料版本、索引原因、资产checkpoint和JSONB索引。 [工程说明](docs/engineering/business-closure.md)与[本轮结果](docs/validation/business-closure-20261105.json)分别记录实现和验收。以下2026-11-04测试计数是历史，不能代替本轮复验。

独立的NestJS/TypeScript DDD后端，维护数据库、权限与业务API，不依赖父目录或前端源码。核对日期：2026-11-04。

上一阶段契约 **1.51.1 / 143 操作**，24个migrations。最近独立冻结安装/check、1462单测、20源码工具、177HTTP框架测试、build及编译OpenAPI通过；真实完整DB859项、资产DB29项及真实存储51项通过。测试范围不可相加。[验收报告](docs/validation/admin-asset-read-authorization-20261104.json)与[文档整理核对](docs/validation/document-lifecycle-20261104.json)分别记录产品与本轮证据；本轮已重跑三仓工程检查和五类来源组合专项，保留既有6条lint警告；完整数据库859项/存储51项为上一阶段独立证据，本轮未重跑。

[五类公开来源真实消息与模型验收](docs/engineering/five-source-kafka-rag.md)及[本轮报告](docs/validation/five-source-kafka-rag-20261104.json)。

[本仓工程/证据索引](docs/README.md)包含DDD、授权、数据库、Kafka/RAG、存储、发布与复现说明；[整理前README](docs/history/README-20261104.md)只作为历史记录。目标浏览器/设备、容器、远程CI及生产环境验收未完成。当前改动未提交/推送/部署。

本轮补充[RAG回填CLI验收报告](docs/validation/rag-backfill-cli-20261104.json)：8项真实PG/BGE-M3用例通过，三仓独立工程检查与构建/导出复验通过；未改产品接口、schema、前端行为或依赖。

本轮补充[Android原生模拟器验收](docs/validation/android-emulator-20261104.json)：11项场景通过，包括SecureStore进程重启/退出、真实RAG对话及历史引用、文章收藏与资料更新；三仓25条工程命令全部通过。Android真机、iOS与签名包仍待验。

最新专项：[SDK58原生上传修复](docs/validation/native-upload-20261104.json)。App使用Blob兼容文件替代旧URI multipart，头像实际上传/扫描/存储及账号绑定通过；多图社区完整原生链仍待验。三仓工程复验通过，失败与资源限制保留。

## 技术栈

- NestJS、TypeScript、DDD 分层模块
- PostgreSQL 17 + pgvector
- Prisma schema、migration 和 seed
- Apache Kafka + PostgreSQL Outbox/Inbox
- DeepSeek 对话模型适配器（OpenAI-compatible API）
- OpenAI-compatible Embedding 适配器，默认 `BAAI/bge-m3`
- Swagger/OpenAPI、Vitest、Oxlint、Prettier

## 领域模块

| 模块                      | 职责                                      |
| ------------------------- | ----------------------------------------- |
| `identity-access`         | 用户、角色、权限、认证上下文和数据范围    |
| `resort-management`       | 雪场基础资料、营业信息和收益查询边界      |
| `community`               | 动态、评论等社区能力                      |
| `knowledge-content`       | 滑雪知识和可被 RAG 索引的内容             |
| `member-engagement`       | 收藏、用户行为等会员能力                  |
| `ai-assistant`            | RAG 检索、引用、对话模型和 Embedding 端口 |
| `platform-administration` | 字典、字段、多级配置和系统管理能力        |
| `integration-events`      | Outbox、Kafka 发布和 Inbox 幂等消费       |

模块内部遵循 `presentation -> application -> domain`，基础设施实现 repository、外部
服务和数据库适配器。领域规则不依赖 NestJS 或 Prisma。

## 环境要求

- Node.js 22，版本基线见 `.nvmrc`
- pnpm 11.25.0
- Docker Desktop / Docker Engine
- 本地 PostgreSQL 17 + pgvector 和 Apache Kafka 4.1.1 可由 `infra/docker-compose.yml`
  启动

## 快速开始

在本仓库根目录执行：

```powershell
Copy-Item .env.example .env
pnpm install --frozen-lockfile
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
pnpm storage:init
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm start:dev
```

首次运行MinIO会从固定官方源码构建，需联网获取Go依赖。原预编译镜像已不可获取；构建代理、私有桶初始化、非root卷权限与真实存储验收见[独立存储说明](docs/engineering/minio-source-storage.md)。执行Compose时显式指定本仓.env，MinIO API/Console默认仅绑定回环。

服务地址：

- API：`http://localhost:8080/api/v1`
- 健康检查：`http://localhost:8080/api/v1/health`
- Swagger UI：`http://localhost:8080/api/docs`
- OpenAPI JSON：`http://localhost:8080/api/docs-json`

单元测试和构建不要求启动Docker。真实数据库、Kafka、存储与模型专项也可按本仓工程说明使用隔离原生服务完成；容器验收另行记录，不能以原生专项替代。健康检查仅表示进程存活。

## 环境变量

关键变量如下，完整示例见 `.env.example`：

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/linji_snow
KAFKA_BROKERS=localhost:9092
KAFKA_EVENTS_TOPIC=linji.integration-events
PORT=8080
WEB_ORIGINS=http://localhost:3000,http://localhost:3001
JWT_ACCESS_SECRET=replace-with-a-random-secret-of-at-least-32-characters
JWT_ACCESS_TTL=15m
REFRESH_TOKEN_TTL_SECONDS=2592000
CHAT_MODEL_BASE_URL=
CHAT_MODEL_API_KEY=
CHAT_MODEL_NAME=deepseek-flash
EMBEDDING_BASE_URL=
EMBEDDING_API_KEY=
EMBEDDING_MODEL=BAAI/bge-m3
```

对话和 Embedding provider 要求兼容 OpenAI API 的 HTTP 服务。启动时要求
`JWT_ACCESS_SECRET` 至少 32 字节；access TTL 允许 1–900 秒（默认 15 分钟），refresh
session 默认固定 30 天。生成随机密钥可用
`node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`。
生产环境必须使用真实随机 JWT secret、模型凭证和精确的 Web Origin allowlist；所有凭证只
放在部署环境，不提交到 Git。

认证采用短效 HS256 access JWT 与随机 opaque refresh token。数据库只保存 refresh token
的 SHA-256，不保存明文；每次刷新轮换，检测到旧 token 重用后撤销整个会话。每个受保护
请求都会检查数据库 session 未过期且未撤销。Web 使用 Secure/HttpOnly/SameSite Cookie，
Cookie 写请求缺 Origin 时直接拒绝；Web 写请求同时验证 allow-listed Origin 与双提交 CSRF；Expo 将 refresh token 存入 SecureStore，
access token 仅驻内存。请将所有 Web 部署 Origin 配置在 `WEB_ORIGINS`。

设置 `INITIAL_ADMIN_ACCOUNT` 与 `INITIAL_ADMIN_PASSWORD` 后运行 seed，可幂等创建初始
系统管理员。两项必须一起配置；seed不重置或自动提升已有账号。该流程不替代正式登录、refresh rotation 或运行时授权。

## 数据库与基础设施

| 命令                                                               | 用途                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| `pnpm db:generate`                                                 | 生成 Prisma Client                                            |
| `pnpm db:migrate -- --name <name>`                                 | 本地开发创建并应用 migration                                  |
| `pnpm db:deploy`                                                   | 应用已提交的 migration                                        |
| `pnpm db:seed`                                                     | 同步内置权限/角色并按配置创建初始管理员                       |
| `pnpm db:verify`                                                   | 校验已应用 migration、pgvector/HNSW、内置角色权限与初始管理员 |
| `pnpm storage:init`                                                | 检查/创建私有图片桶，幂等保留对象与已有访问策略               |
| `docker compose --env-file .env -f infra/docker-compose.yml up -d` | 启动 PostgreSQL/pgvector、Kafka、MinIO 和 ClamAV              |
| `docker compose --env-file .env -f infra/docker-compose.yml down`  | 停止本地基础设施                                              |

数据库由 Backend 独占。Web/App 不维护自己的业务 schema，也不直连 PostgreSQL。

## API 契约与客户端协作

运行 `pnpm openapi:generate` 会先构建 Backend，再将正式路由导出到
`contracts/openapi.json`。Web 和 App 各自保存一份版本化快照和 SHA-256 锁文件，并在
自己的仓库生成 TypeScript 类型。

当前契约版本为 `1.51.1`，Web/App 快照 SHA-256 为 `e5570e24af7bf5670cda3914591924f3c0d4321248c01ce0e7d2a95bd34745a8`。契约包括认证、字段/分组、角色/授权、账号、字典、Asset、商家/全局/公开雪场、权限目录、文章/项目知识管理、收藏、社区动态/评论、管理审核、系统配置/公开投影、收益恢复、操作日志/事件查询重试、RAG来源运维及AI会话审计接口。接口详情以 `contracts/openapi.json` 为准：
`GET /api/v1/auth/csrf`、`POST /api/v1/auth/register`、`POST /api/v1/auth/login`、
`POST /api/v1/auth/refresh`、`POST /api/v1/auth/logout`、`GET /api/v1/auth/me`、
`GET /api/v1/admin/roles/{id}/permissions`、`PUT /api/v1/admin/roles/{id}/permissions`。契约路径并不表示每个接口均已完成生产验收；新增接口时
必须同步 Controller、DTO、VO、application 用例、领域/仓储端口、权限、OpenAPI、测试和
追踪文档，不能只修改 Swagger 文件。

## 权限与数据范围

- 游客、注册用户、商家和系统管理员是业务主体；商家身份由 `MerchantProfile` 表达，不由 `RoleKey=merchant` 运行时判定。
- 管理端入口和商家操作由权限目录、角色授权与数据范围决定；`merchant` 是 DataScope 值。RAG 私有来源还要求 `ai:rag:query` 显式授权。
- 商家可以管理本人商家范围内的雪场数据，并只读查看本人商家收益数据。
- 收益写入和导入由系统管理员或受控后台任务负责，不属于商家权限。
- 系统管理员通过显式 RBAC 权限管理用户、角色、菜单、字段、字典和业务数据。
- 授权采用 fail-closed：路由、角色、permission、账号状态和数据范围均由后端校验。

角色默认 DataScope 与授权快照仅系统管理员可配置；四类角色写事务重新核对当前身份、管理入口、动作权限及 role 范围，管理员专属配置另核实受保护成员关系。普通角色管理员只可创建 self 空角色并维护获准的元数据。实现、测试和快照边界见 [角色事务授权](docs/engineering/role-write-authorization.md)；[角色范围授权说明](docs/engineering/role-scope-authorization.md)保留历史设计记录。

全局雪场管理七类操作要求 `resort` all 范围与对应动作权限，Controller/Application 均强制检查；非 all 不可调用全局接口。实现与真实数据库待验项见 [全局雪场范围说明](docs/engineering/global-resort-scope.md)。

商家雪场与收益已落实 D-38 范围交集、selected 禁止创建及四类写入同事务审计，见 [商家范围与审计](docs/engineering/merchant-resort-scope.md)。

社区字面关键词查询与数据库验收见 [社区查询复验](docs/engineering/community-query-recovery.md)。

公开知识目录真实 HTTP/PostgreSQL 验证和关键词修复见 [知识目录查询验收](docs/engineering/public-knowledge-directory.md)。

商家雪场与收益的 Application 已移除 Prisma、HTTP DTO 和 Infrastructure 依赖，使用业务 Repository/事务端口，见 [商家与收益 DDD](docs/engineering/merchant-resort-ddd.md)。全局管理与公开查询也已拆分业务端口和 Prisma 适配器，公开筛选/距离排序/分页下推数据库，架构门禁覆盖 ResortManagement 全部 Application/Domain，见 [全局与公开雪场 DDD](docs/engineering/global-public-resort-ddd.md)。查询快照、数据库映射、引用校验、Outbox/审计由适配器实现；真实 PostgreSQL 查询、事务授权和公开筛选专项已复验；性能验收仍未执行。

权限目录、收益恢复、社区审核及聊天HTTP/SSE均有实现和真实HTTP/数据库专项。登录限流已采用PostgreSQL双桶共享计数，所有尝试计数，429返回Retry-After且不自动重试；完整DB、Kafka/真实模型与存储证据见[本仓索引](docs/README.md)。目标浏览器/设备、生产负载及全部并发组合仍待验。

## AI RAG 边界

2026-11-04 真实供应商接入：DeepSeek 官方认证及正式适配器流式调用已通过，已验证 API 模型名为 `deepseek-flash`。新增 `pnpm ai:verify --chat|--embedding|--all`；后续已完成隔离合成语料的真实 Embedding/HTTP RAG 专项，见上述真实 RAG 记录；项目知识实际消息链已通过本轮组合专项；生产常驻和长期索引运行待验。详见 [接入计划与当前结果](docs/engineering/real-ai-provider-integration.md)。密钥仅保存在本地 Git 忽略文件，不进入前端或交付文档。

AI 会话 CRUD、软删除、偏移分页和消息 SSE 已实现，接口/迁移/幂等与限流说明见 [AI 会话实现](docs/engineering/ai-conversations.md)。`pnpm test:db` 提供真实数据库并发验收，需专用已迁移数据库；本机专用库已执行 26 项 AI 数据库测试（含 22 项真实 HTTP/SSE/pgvector 联合测试），详见 [联合验收](docs/engineering/ai-http-rag-validation.md)；真实供应商的合成语料专项见本轮 RAG 说明；目标设备与生产部署仍待验收。

RAG 数据源包括雪场资料、滑雪知识和经授权的项目业务数据。pgvector 只保存文档块的
Embedding；检索结果必须先经过公开策略或显式的 `ai:rag:query` grant/DataScope 过滤，
再交给对话模型生成答案，并返回可追溯引用。

当前已具备文档分块、Embedding、幂等索引、权限范围检索和上下文准备的应用层能力；雪场、文章、项目知识、审核公开动态和显式公开字典有 Outbox/Kafka handler。聊天会话 API/SSE/持久化已实现；消息上限 4000 字符、每用户滚动 60 秒最多 5 个新请求已由服务端校验。实时来源校验与回填 CLI 已实现，升级前须阅读 [RAG 来源与回填说明](docs/engineering/rag-source-visibility.md)；旧索引缺少快照会默认隐藏。真实数据库用例已通过；Kafka/真实Embedding/DeepSeek组合与三类主要来源已通过隔离专项；全部存量回填、实际业务语料与生产长期运行待验。

对话已接近期已完成轮次的用户问题上下文：最多 4 条、合计 2000 Unicode 字符，检索查询及模型资料都有大小限制；历史 assistant 内容与引用不重新作为证据。按本轮权限重新检索，无来源拒答。具体规则与指代限制见上方 AI 会话实现说明；真实模型多轮效果尚未验收。

D-46 RAG 来源运维和 D-47 AI 会话受控审计已实现；人工停用、generation fencing、Inbox 事件处理、最少元数据、独立正文权限及同事务审计见 [AI 运维接口](docs/engineering/ai-operations.md)。[早期专项](docs/engineering/ai-operations-database-validation.md)在23项migration时通过会话审计11项/RAG控制14项，属于历史证据；当前24项迁移与完整数据库结果见本文开头报告。真实Kafka、Embedding及三类主要来源的组合链路已有后续专项，浏览器与生产长期运行仍待验。

## 常用命令

本人动态列表/详情与既有角色升级授权说明见 [本人动态查询](docs/engineering/own-dynamics.md)。

社区动态/评论/点赞/审核的 Domain、Application 端口与 Prisma 事务实现及验收边界见 [Community DDD 说明](docs/engineering/community-ddd.md)。社区分层已增加 AST 门禁；其他上下文仍需逐项审计。

文章管理、项目知识与公开文章查询已完成应用仓储/读取端口、Prisma 适配器和 Domain 拆分，并加入 AST 门禁。D-39 文章范围与公开分类 DictType 修复、事务/测试边界见 [知识内容 DDD 与文章范围](docs/engineering/knowledge-content-ddd.md)。知识内容真实 PostgreSQL 19 项已通过；当前字段策略与事务内授权见 [文章字段授权](docs/engineering/article-field-authorization.md)。

收藏 API-F01 已完成业务端口、纯领域规则与 Prisma 适配器分层；添加与列表统一公开目标规则，添加采用 Serializable，列表/count 使用 RepeatableRead。HTTP 测试装配真实收藏应用服务，5 项真实数据库验收已通过。详见 [收藏模块 DDD 与可见性](docs/engineering/member-favorites-ddd.md)。

| 命令                            | 用途                                                    |
| ------------------------------- | ------------------------------------------------------- |
| `pnpm start:dev`                | Nest watch 开发服务                                     |
| `pnpm build`                    | 构建生产代码                                            |
| `pnpm start:prod`               | 运行 `dist` 生产构建                                    |
| `pnpm check`                    | lint、类型、单元与源码导出工具测试                      |
| `pnpm test:e2e`                 | 运行 HTTP e2e 测试                                      |
| `pnpm test:storage-integration` | 运行独立MinIO/ClamAV/PG真实私有存储专项，需专用测试环境 |
| `pnpm test:cov`                 | 生成测试覆盖率                                          |
| `pnpm openapi:generate`         | 生成并保存 OpenAPI artifact                             |

## CI 与发布

Backend停机先停止后台任务并等待当前工作，再关闭Kafka producer；HTTP服务关闭后才断开Prisma。Outbox与收益清理的等待、真实HTTP/消息/RAG重放验证及生产信号边界见[任务停机顺序](docs/engineering/worker-shutdown.md)。部署时须给正常终止留出任务和HTTP/SSE的退出时间；强杀依然依赖持久租约/重试恢复。

GitHub Actions 配置在 `.github/workflows/ci.yml`，会执行 frozen install、Prisma schema
校验、client generate，并在 PostgreSQL/pgvector 17 服务容器从空库应用 migration、连续
运行两次 seed 后校验数据库和权限边界；随后执行 lint、类型检查、测试、e2e 和 build。
此 CI 配置尚未由远程 runner 执行验证。部署时需要独立配置
PostgreSQL/pgvector、Kafka、JWT、CORS 和模型 provider；migration 必须在应用启动前完成。

- [D-30 本人资料工程说明](docs/engineering/own-profile.md)
- [D-46/D-47 AI 运维接口工程说明](docs/engineering/ai-operations.md)
- [AI管理真实数据库验收与复现](docs/engineering/ai-operations-database-validation.md)

- [全局雪场响应契约补齐](docs/engineering/admin-resort-response-contract.md)

- [App 收藏恢复独立 HTTP](docs/engineering/app-favorite-recovery-http.md)

- [AI原请求恢复独立HTTP](docs/engineering/ai-runtime-recovery-http.md)

- [Kafka长任务心跳与失败排空](docs/engineering/kafka-handler-heartbeats.md)

- [文件扫描总时限与超时状态验证](docs/engineering/scanner-deadline.md)

- [S3运行时请求时限与失败状态验证](docs/engineering/s3-deadline.md)

- [Windows独立MinIO/ClamAV/PG存储验收](docs/engineering/native-storage-validation.md)

- [管理端资产与真实私有存储验收](docs/engineering/admin-assets-real-storage.md)

源码接收校验：在安装依赖/创建.env前运行 `pnpm source:verify <副本绝对路径> <外部可信sourceSha256>`，或直接用Node运行校验器。详见[独立源码导出与冷安装](docs/engineering/source-export.md)。
