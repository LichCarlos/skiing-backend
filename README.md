# 凛迹雪客 · skiing-backend

凛迹雪客的独立 Backend API。统一提供认证与 RBAC、雪场、内容/社区、收藏、资产、商家收益、字典/字段、审计和 AI RAG。供 [skiing-web](https://github.com/LichCarlos/skiing-web) 与 [skiing-app](https://github.com/LichCarlos/skiing-app) 通过 HTTP/OpenAPI 使用，客户端不直连数据库。

线上 API 基址：[https://lichcarlos.top/snow-api/api/v1](https://lichcarlos.top/snow-api/api/v1)，[健康检查](https://lichcarlos.top/snow-api/api/v1/health)。健康检查表示进程可响应，不能代替数据库、存储、队列与模型业务验证。

## 当前版本

2026-11-12 已部署 OpenAPI **1.55.0**：取消社区图片 9 张、正文图片 30 张等固定数量门槛，保留资产归属、单图约束和安全校验。本次没有数据库迁移；已有 **27** 个迁移。1528 项单测、178 项框架 HTTP 测试及 Linux 构建通过，生产克隆数据库中的 49 项 HTTP/数据库测试包含 150 张图片的创建/编辑/公开读取。见[图片更新记录](docs/engineering/article-images-20261112.md)。历史测试数字只描述对应阶段。

## 教程入口

| 目标                                | 文档                                                  |
| ----------------------------------- | ----------------------------------------------------- |
| 了解整体架构、从零学习              | [三仓协作与技术路线](docs/guide/learning-roadmap.md)  |
| 本地依赖、数据库、首个 API          | [本地开发教程](docs/guide/development.md)             |
| Linux / 容器、迁移、Nginx、备份回滚 | [部署与运维教程](docs/guide/deployment.md)            |
| SDK、凭证、Git 提交与扫描           | [公开仓库安全管理](docs/guide/repository-security.md) |
| 详细业务与专项结果                  | [文档索引](docs/README.md)                            |

## 技术栈与模块

Node.js **22**、NestJS **11**、TypeScript **6**、Prisma **6.19.0**、PostgreSQL **17 / pgvector**、Kafka **4.1.1**、S3-compatible 私有存储、ClamAV、OpenAI-compatible Chat/Embedding 适配器、Swagger、Vitest、Oxlint。

| 模块                    | 职责                               |
| ----------------------- | ---------------------------------- |
| identity-access         | 用户、角色、权限、会话、数据范围   |
| resort-management       | 雪场、商家资料、收益               |
| community               | 动态、评论与审核                   |
| knowledge-content       | 文章、项目知识与公开来源           |
| member-engagement       | 收藏及本人操作                     |
| platform-administration | 字典、扩展字段、系统配置与审计     |
| assets                  | 图片上传、归属、扫描和私有读取     |
| ai-assistant            | 会话、SSE、检索、引用、模型端口    |
| integration-events      | 事务 Outbox、Kafka、Inbox 幂等消费 |
| health                  | 存活检查                           |

```text
src/modules/          按业务域组织，presentation/application/domain/infrastructure
src/shared/           数据库、HTTP、内容及通用基础
prisma/               schema、已提交迁移、seed
contracts/            正式路由导出的 OpenAPI
infra/                本地基础设施、生产容器模板
scripts/              运维、验证、源码导出与契约工具
test/                 框架 HTTP、真实数据库及服务集成测试
docs/                 教程、工程记录和验收
```

依赖方向为 presentation → application → domain；基础设施实现端口。领域规则不依赖 Nest/Prisma，跨域不得绕过业务授权直接写表。

## 快速开始

需要 Node.js **22.16.0**、pnpm **11.25.0**、Docker Engine / Docker Desktop（或自行提供兼容基础设施）。

```bash
git clone https://github.com/LichCarlos/skiing-backend.git
cd skiing-backend
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
```

复制 `.env.example` 为 `.env`（PowerShell：`Copy-Item .env.example .env`；Bash：`cp .env.example .env`）。设置独立随机 `JWT_ACCESS_SECRET`、`LOGIN_RATE_LIMIT_SECRET`、存储密码和初始管理员账号密码。模板值仅供开发定位，生产必须替换。模型 API Key 不必配置即可开发非 AI 功能，AI 完整链路需有效模型与 Embedding。

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
# 等 PostgreSQL/ClamAV/存储就绪后执行
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm db:verify
pnpm storage:init
pnpm start:dev
```

本地端口：API `8080`，PostgreSQL `5432`，Kafka `9092`，对象存储 `9000/9001`，ClamAV `3310`。完整镜像构建和病毒库初始化可能较慢；遇端口冲突先修改环境与对应 URL，不停止其他项目。

- API：`http://localhost:8080/api/v1`
- 健康检查：`http://localhost:8080/api/v1/health`
- Swagger：`http://localhost:8080/api/docs`
- OpenAPI JSON：`http://localhost:8080/api/docs-json`

`seed` 同步内置权限/角色并按配置创建初始管理员，不会为教程提供统一默认密码。生产已有库不要为了更新代码反复初始化；迁移、seed 和测试数据库的区别见[开发教程](docs/guide/development.md)。

## 环境变量分类

| 类别       | 主要变量                                                                     | 要点                                                          |
| ---------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 数据库     | DATABASE_URL                                                                 | 独立开发库；生产账号最小权限                                  |
| 认证       | JWT_ACCESS_SECRET、LOGIN_RATE_LIMIT_SECRET、WEB_ORIGINS、TRUSTED_PROXY_CIDRS | 两个不同随机秘密；明确可信 Origin/代理                        |
| 消息       | KAFKA__、OUTBOX__                                                            | 本地默认不启 consumer；完整索引链需 consumer、topic 和 broker |
| AI         | CHAT_MODEL__、EMBEDDING__                                                    | 模型名以供应商可用列表为准；向量维度须兼容库中索引            |
| 存储       | S3__、CLAMAV__                                                               | 私有桶、可达签名入口、扫描服务                                |
| 初次初始化 | INITIAL_ADMIN_ACCOUNT、INITIAL_ADMIN_PASSWORD                                | 本地私有值，不提交 Git                                        |

完整参数见 [.env.example](.env.example)；生产模板见 [infra/backend.production.env.example](infra/backend.production.env.example)。

## 常用命令

| 命令                                     | 用途                                     |
| ---------------------------------------- | ---------------------------------------- |
| `pnpm check`                             | lint、类型、单测与源码导出工具检查       |
| `pnpm build` / `pnpm start:prod`         | 构建 / 启动 API                          |
| `pnpm test:e2e`                          | 框架 HTTP 测试                           |
| `pnpm test:db`                           | 真实数据库测试，必须使用专用可丢弃测试库 |
| `pnpm db:migrate --name <name>`          | 开发库创建迁移                           |
| `pnpm db:deploy`                         | 按既有迁移升级数据库                     |
| `pnpm db:backup` / `pnpm db:restore-new` | 备份 / 恢复到新库，参数见部署教程        |
| `pnpm openapi:generate`                  | 构建并导出正式 API 契约                  |
| `pnpm rag:reindex -- --help`             | 查看历史 RAG 回填工具用法                |
| `pnpm ai:verify --all`                   | 检查配置的真实模型，可能产生供应商费用   |
| `node scripts/check-repository.mjs`      | 检查公开文件边界                         |

数据库/存储/Kafka 等集成测试使用隔离资源，不能对生产库执行。费用型真实模型专项只在明确需要时运行。完整检查矩阵见 `.github/workflows`，提交不代表 Actions 已通过。

## 发布与维护

提供多阶段 [Dockerfile](Dockerfile) 和 [compose.release.yml](infra/compose.release.yml)：runtime 只跑 API，tools 显式执行迁移，不在每次进程启动时隐式 seed/migrate。也可使用匹配平台 Node 构建并由 systemd 管理。当前生产采用后者配合独立基础设施。

部署顺序为备份 → 隔离验证 → 迁移评估 → 候选服务 → 切换 → 业务检查 → 保留回滚包。Chat/Embedding、私有桶和队列要分别验收。当前本地 BGE-M3 经受控隧道服务生产，开发机离线会影响语义检索；独立服务器模型部署仍需另行规划。

详见[完整部署教程](docs/guide/deployment.md)、[仓库安全](docs/guide/repository-security.md)与[公开前历史 README](docs/history/readme-before-publication-20261112.md)。
