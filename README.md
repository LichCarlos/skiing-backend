# 凛迹雪客 · skiing-backend

独立 NestJS API，统一提供账号/RBAC、雪场、知识/社区、收藏、资产、商家收益、字典/扩展字段、审计和 AI RAG。客户端通过 HTTP/OpenAPI 使用业务，不直接连接数据库。

| 仓库                                                   | 职责                               | 推荐顺序   |
| ------------------------------------------------------ | ---------------------------------- | ---------- |
| **skiing-backend（本仓）**                             | 业务、持久化、认证、模型与基础设施 | 先启动     |
| [skiing-web](https://github.com/LichCarlos/skiing-web) | 官网与桌面管理端                   | API 之后   |
| [skiing-app](https://github.com/LichCarlos/skiing-app) | Expo Web / Android / iOS           | Web 闭环后 |

线上[健康入口](https://lichcarlos.top/snow-api/api/v1/health)仅说明进程存活，不要对线上库执行学习测试或初始化。

## 1. 空白电脑从这里开始

**按[从空白电脑到三端运行与部署](docs/guide/from-zero.md)准备环境。** 三仓都附完整手册：Windows/WSL2、Ubuntu、版本下载、Docker 就绪、初始化、前端联调、AI、Nginx/TLS、App 打包与备份。

推荐分阶段完成：**API/数据库 → 账号权限 → 官网管理端 → 上传审核 → AI 索引 → App → 公网部署/恢复**。不用为了学习第一个 Controller 先安装 Android SDK 或本地大模型。

## 2. 环境与下载

| 工具/服务                    | 基线版本                                   | 获取方式                                                                                                                            |
| ---------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Node.js                      | **22.16.0**，engines >=22.14.0             | [官方下载与校验和](https://nodejs.org/dist/v22.16.0/)                                                                               |
| pnpm                         | **11.25.0**                                | `npm install --global pnpm@11.25.0`                                                                                                 |
| Git                          | 2.47+                                      | [官方下载](https://git-scm.com/downloads)                                                                                           |
| Docker / Compose             | Desktop 4.40+ 或 Engine 28+；Compose 2.34+ | [Windows](https://docs.docker.com/desktop/setup/install/windows-install/)、[Ubuntu](https://docs.docker.com/engine/install/ubuntu/) |
| PostgreSQL / pgvector        | **17**，`pgvector/pgvector:pg17`           | Compose 拉取，init/迁移启用 vector                                                                                                  |
| Kafka                        | **4.1.1**，`apache/kafka:4.1.1`            | Compose 拉取                                                                                                                        |
| MinIO                        | 固定源码 commit `9e49d5e7a648…`            | infra/minio/Dockerfile 自动校验构建                                                                                                 |
| ClamAV                       | **1.4.3**                                  | Compose 拉取，首次下载病毒库                                                                                                        |
| NestJS / Prisma / TypeScript | **11 / 6.19.0 / 6**                        | 冻结锁文件，无需全局框架 CLI                                                                                                        |
| Chat / Embedding             | OpenAI-compatible；向量固定 **1024维**     | 自己的有效供应商/自托管服务                                                                                                         |

建议 16 GB 内存、80 GB 空闲磁盘；Linux 示例为 Ubuntu 24.04 LTS。Node 版本为复现基线，公开生产使用受支持的最新 22.x 安全补丁并检查。镜像可变标签在发布时记录/固定 digest。安装、系统条件和校验见[手册第 1 节](docs/guide/from-zero.md)。

## 3. 安装与私有配置

```bash
git clone https://github.com/LichCarlos/skiing-backend.git
cd skiing-backend
node --version
npm install --global pnpm@11.25.0
pnpm --version
pnpm install --frozen-lockfile
```

复制 `.env.example` 为 `.env`：PowerShell 用 `Copy-Item .env.example .env`，Bash 用 `cp .env.example .env`。保留模板参数，至少填写：

| 键                                                 | 本地规则                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `DATABASE_URL`                                     | 默认 `postgresql://postgres:postgres@localhost:5432/linji_snow`，仅供隔离本机开发 |
| `JWT_ACCESS_SECRET`                                | 第一份独立随机秘密                                                                |
| `LOGIN_RATE_LIMIT_SECRET`                          | 第二份不同秘密，不复用 JWT secret                                                 |
| `INITIAL_ADMIN_ACCOUNT` / `INITIAL_ADMIN_PASSWORD` | 自己的初始管理员，二者同时设置，无通用密码                                        |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`        | 自己的存储账号/密码，Compose/API 一致                                             |
| `WEB_ORIGINS`                                      | `http://localhost:3000,http://localhost:3001,http://localhost:8081`，按实际调整   |
| `KAFKA_CONSUMER_ENABLED`                           | 普通业务先 false，模型/索引准备后再开启                                           |

分别运行两次，生成不同秘密并写入自己的 .env：

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

真实 .env、密码和模型 Key 不进 Git；没有模型也能先做非 AI 功能。本机模板不是生产安全配置。

## 4. 基础设施、迁移与启动

Docker Desktop 需处于 Linux containers，Server 可用。当前目录仍是 Backend：

```bash
docker version
docker compose version
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
docker compose --env-file .env -f infra/docker-compose.yml ps
docker compose --env-file .env -f infra/docker-compose.yml logs --tail 80 postgres kafka minio clamav
docker compose --env-file .env -f infra/docker-compose.yml exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --create --if-not-exists --topic linji.integration-events --partitions 3 --replication-factor 1
```

Postgres/Kafka healthy、MinIO API 已启动、ClamAV 病毒库和扫描进程就绪后：

```bash
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm exec tsx --env-file=.env scripts/verify-database.ts
pnpm storage:init
pnpm start:dev
```

校验脚本显式加载 .env，不依赖终端预设 DATABASE_URL。`pnpm db:verify` 可在已安全提供该环境变量的进程运行；Prisma 迁移/seed 由 prisma.config.ts 加载配置。

| 操作                   | 作用                                                 |
| ---------------------- | ---------------------------------------------------- |
| db:generate            | 生成 Client，不修改数据库                            |
| db:deploy              | 应用已提交迁移，不创建新迁移                         |
| db:seed                | 同步角色/权限并按配置创建管理员；不导入线上雪场/文章 |
| storage:init           | 创建/核对私有资产桶，不开放匿名读取                  |
| db:migrate --name 名称 | 个人开发库创建迁移，不能用于生产                     |

MinIO 首次源码构建、ClamAV 下载可能较慢，按日志等待。`docker compose down -v` 删除数据卷，不作为排错默认操作。

| 本地地址                              | 预期         |
| ------------------------------------- | ------------ |
| `http://localhost:8080/api/v1/health` | API 响应成功 |
| `http://localhost:8080/api/docs`      | Swagger      |
| `http://localhost:8080/api/docs-json` | OpenAPI JSON |

Postgres 5432、Kafka 9092、MinIO 9000/9001、ClamAV 3310。启动 [Web/Admin](https://github.com/LichCarlos/skiing-web)，用自己 seed 的管理员创建公开内容；新库空列表正常。

## 5. 循序渐进地学习

| 阶段 | 知识/入口                         | 练习与通过标准                                            |
| ---- | --------------------------------- | --------------------------------------------------------- |
| 1    | Node/TS、HTTP、Git                | 独立启动 API，读懂响应和错误                              |
| 2    | Nest Module、DI、DTO、Controller  | 沿雪场查询找到路由→用例→repository，运行附近测试          |
| 3    | SQL、Prisma、关系/索引/事务       | 隔离开发库改字段并提交 migration，解释生成与迁移          |
| 4    | Cookie/CSRF、access/refresh、RBAC | 普通用户不能越权、切号不串数据                            |
| 5    | DDD 分层、跨域协作                | domain/application 维护规则，基础设施实现端口，不绕权写表 |
| 6    | 字典/字段、资产、审核、私有存储   | 分类→上传→提交→审核→公开，理解知识索引条件                |
| 7    | Outbox/Kafka/Inbox、幂等、重试    | 来源事件到1024维索引可追踪、失败可恢复                    |
| 8    | SSE、模型协议、检索与引用         | 真实回答/历史/取消通过，不把 health 当模型可用            |
| 9    | Linux、TLS、测试、恢复            | 独立部署、隔离恢复验证、演练回滚                          |

完整三仓路线：[learning-roadmap.md](docs/guide/learning-roadmap.md)。推荐从 Web 的一个只读请求追到本仓，再看 App 同业务，理解统一后端规则。

```text
src/modules/          业务域：presentation/application/domain/infrastructure
src/shared/           数据库、HTTP、诊断和通用基础
prisma/               schema、SQL migrations、seed
contracts/            正式实现导出的 OpenAPI
infra/                本地依赖、生产容器模板
scripts/              运维、验证、契约、交付工具
test/                 框架HTTP、数据库、服务集成测试
docs/                 教程、架构、工程记录
```

主要域：identity-access、resort-management、community、knowledge-content、member-engagement、platform-administration、assets、ai-assistant、integration-events。字典/字段维护既有实体配置，不任意创建 SQL 表。

## 6. AI 的全部前置条件

普通业务闭环之后按[手册第 6 节](docs/guide/from-zero.md)配置：

1. 可达 Chat、自己账号可用的模型 ID 和私有 Key。
2. OpenAI-compatible Embedding，返回 **1024维**向量，模型与库索引一致。
3. Kafka topic、Outbox dispatch、consumer 与公开可用来源。
4. 正确 base URL：直接追加 /chat/completions 或 /embeddings，不重复 /v1。
5. 独立供应商验证，再做索引与真实对话验收。

```bash
pnpm ai:verify --help
pnpm ai:verify --all
pnpm rag:reindex -- --help
```

`--all` 实际调用供应商，可能收费；回填批次和检查点按帮助选择。Chat 与 Embedding 分别验证，Chat Key 不自动提供 RAG。作者本机模型/反向隧道不是新部署的依赖，生产使用独立可靠服务。

## 7. 检查和构建

```bash
pnpm check
pnpm test:e2e
pnpm build
```

| 命令                                 | 用途                                            |
| ------------------------------------ | ----------------------------------------------- |
| pnpm check                           | lint、类型、业务单测、源码工具                  |
| pnpm test:e2e                        | 框架 HTTP 测试                                  |
| pnpm test:db                         | 真实数据库专项，只用可丢弃测试库                |
| pnpm openapi:generate                | 构建并导出正式契约                              |
| pnpm build / pnpm start:prod         | 生成 dist / 启动API，需要匹配平台依赖与私有环境 |
| pnpm db:backup / pnpm db:restore-new | 加密备份/恢复新库，先读教程与 --help            |
| node scripts/check-repository.mjs    | Git 公开边界                                    |

真实数据库/Kafka/存储/扫描/供应商测试各有资源要求，不对生产运行集成测试。契约由本仓导出，客户端同步快照、版本/SHA 后生成类型，不手改类型掩盖差异。

## 8. 全新 Linux 服务器发布

[手册第 7—8 节](docs/guide/from-zero.md)包含 Ubuntu 安装、账号/私有配置、loopback Docker、新库迁移、Linux 构建、三个 systemd unit、域名/DNS、Certbot、完整 Nginx、API Cookie 路径、S3 签名、SSE 和配套备份回滚。

另有 [Dockerfile](Dockerfile) runtime/tools 与 [compose.release.yml](infra/compose.release.yml)方案。**release Compose 只有 API/tools，没有数据库、Kafka、S3、扫描或 TLS**，必须另行准备容器可达服务。容器 localhost 指自己，不能复制宿主 URL；迁移 tools 显式执行，API 不隐式迁移/seed。细节见[部署运维](docs/guide/deployment.md)。

检查 API 监听、Docker 映射和云安全组，只公开 SSH 与80/443；HTTPS 登录、上传、AI/索引分别验收。健康 200 不等于全部业务可用。

## 9. 排错、状态与文档

| 现象                | 检查                                           |
| ------------------- | ---------------------------------------------- |
| P1001 / vector 缺失 | URL、容器就绪、pgvector 镜像和迁移             |
| 管理员不存在        | 账号/密码同时配置、seed 成功；空库没有默认用户 |
| 登录刷新掉线        | Origin、Secure Cookie、HTTPS、代理 Cookie Path |
| 图片超时/403        | 桶、签名入口/Host、时钟、ClamAV 就绪           |
| AI timeout / 无引用 | 两模型 smoke、1024维、公开来源、队列/索引/SSE  |
| db:verify 缺 URL    | 显式 --env-file 命令或安全加载环境             |

维护日期 **2026-11-19**，当前 OpenAPI **1.55.0**、27 个已提交迁移。2026-11-12 已上线取消固定图片张数门槛的更新，单图/归属/扫描/正文限制保留，见[专项记录](docs/engineering/article-images-20261112.md)。历史状态按日期理解。

入口：[从零教程](docs/guide/from-zero.md) · [路线](docs/guide/learning-roadmap.md) · [开发](docs/guide/development.md) · [部署备份](docs/guide/deployment.md) · [安全](docs/guide/repository-security.md) · [文档索引](docs/README.md)。CI 不自动部署；SDK、依赖、真实 .env、模型、签名、备份不进 Git。教程不表示已替读者完成新主机、容量和灾备验收，应按每阶段实测。
