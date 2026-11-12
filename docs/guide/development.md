# Backend 本地开发与接口协作

## 初始化

按 README 安装 Node 22.16.0、pnpm 11.25.0，复制 `.env.example`。生产配置和数据库不能用于开发测试。生成两个不同的随机秘密可用 `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`，输出只保存到私有配置，不粘到提交或公开日志。

本地 `DATABASE_URL` 默认指 PostgreSQL 5432 的 linji_snow；存储账号/密码必须和 Compose 的 MinIO 一致。初始化管理员的账号密码由自己设置，不存在教程通用密码。不要运行来自未知来源的 seed 或 SQL。

```bash
pnpm install --frozen-lockfile
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm db:verify
pnpm storage:init
pnpm start:dev
```

ClamAV 首次下载病毒库、MinIO 从源码构建需要时间。先看各服务就绪状态，避免以重复重启掩盖初始化。只开发不需存储/AI 的功能可逐项准备依赖，但完整业务验收必须有相应真实基础设施。

## 首个请求与代码阅读

访问 `http://localhost:8080/api/v1/health`，再查看 `/api/docs`。统一前缀由 `src/shared/http/configure-http.ts` 配置；响应与错误使用统一适配，输入 DTO 做白名单校验。

从模块 `presentation/http` 找路由和 DTO，再进入 application 用例、domain 规则、infrastructure 数据库/外部服务适配。权限、数据范围、实体状态和资产归属须在写事务的正确位置复核。不要在 Controller 或 Prisma 查询中临时绕开 domain 规则。

## 数据库开发规则

| 工具                              | 目的                           | 使用环境                       |
| --------------------------------- | ------------------------------ | ------------------------------ |
| `pnpm db:generate`                | 根据 schema 生成 Prisma Client | 安装后/schema 改动后；不迁移库 |
| `pnpm db:migrate --name <变更名>` | 生成并应用开发迁移             | 个人开发数据库                 |
| `pnpm db:deploy`                  | 按已提交迁移升级库             | 测试与经评估的生产环境         |
| `pnpm db:seed`                    | 内置权限/角色与初始管理员同步  | 新环境明确初始化时             |
| `pnpm db:verify`                  | 核对迁移、扩展、内置数据等     | 初始化/升级后                  |

改 schema 时同步提交 SQL migration；不手改已经在共享/生产应用过的历史迁移。删除字段、收紧约束和向量索引变化要评估已有数据，采用兼容过渡。字典/字段配置通常是业务数据变更，不等同于修改 SQL 表结构。

本地 Compose 的 `down` 停止服务，默认保留命名卷；`down -v` 会删数据，不作为普通教程步骤。不要为了重建开发环境删除其他项目的数据卷。

## 认证与权限联调

浏览器使用 Cookie/CSRF，原生使用 access/refresh 平台通道。配置 `WEB_ORIGINS` 为 UI 的准确 Origin，不含路径。`TRUSTED_PROXY_CIDRS` 只列出确实受控的代理；不可为图省事信任任意转发头。

管理端导航过滤是用户体验层，接口仍检查权限键、有效角色、商家绑定和数据范围。调试 403 时逐项核对账号与授权，不能把普通角色临时改成系统管理员来消除失败。

## 图片、内容与知识

资产上传经请求授权、归属、大小/MIME 与扫描校验后才允许用于内容。每篇内容无固定图片张数上限，但正文字符、请求体、文件大小和正常资源预算仍有界。重复 asset ID 或非本人/不可用资产仍被拒绝。

社区笔记需审核才公开，知识文章与项目知识由对应权限流程维护；公开可用来源才进入索引。字段/字典停用和依赖变化也可能触发索引清理。不要仅给一段文本打“知识库”标签就跳过来源与可见性约束。

## Kafka 与 AI

本地默认 `KAFKA_CONSUMER_ENABLED=false`。需要完整异步 RAG 时准备 broker/topic、启用对应 consumer 与 Outbox，并配置可达的 Embedding 与 Chat。写入业务事务先进入 Outbox，随后 Kafka / Inbox 幂等消费与向量索引更新；延迟应检查每一阶段。

```bash
pnpm ai:verify --help
pnpm rag:reindex -- --help
```

真实模型检查可能产生费用。配置的模型名、API 路径、Embedding 维度与当前向量索引必须一致。回填需检查点、幂等和失败恢复，不可把生产库当负载测试环境。

## 测试矩阵

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm openapi:generate
```

数据库测试使用专用可丢弃数据库、已应用迁移，并按对应测试配置要求设置确认变量（例如 `LINJI_DATABASE_TEST_DISPOSABLE=true`）。不要仅设置一个布尔变量就把生产 URL 当安全测试库。真实 Kafka、存储、扫描和供应商测试有各自参数与验收范围，先阅读对应 config 和工程说明。

GitHub CI 的 PostgreSQL/pgvector 服务和集成矩阵提供可参考的独立环境；本地单测、HTTP 框架测试与真实服务测试分别记录，测试数不能简单相加为覆盖率。

## OpenAPI 与提交

后端导出为契约唯一来源。客户端同步快照、版本和原始字节 SHA，再生成类型。修改响应时同步维护 DTO、OpenAPI 和运行时实现，不让断言类型代替数据校验。流程见[三仓路线](learning-roadmap.md)。

## 常见故障

| 现象                    | 优先检查                                                             |
| ----------------------- | -------------------------------------------------------------------- |
| Prisma Client 未生成    | 执行 db:generate，确认安装脚本政策允许 Prisma 引擎                   |
| 启动时报数据库/扩展缺失 | URL、数据库存在、pgvector 安装、迁移与权限                           |
| 管理员登录失败          | seed 是否创建、实际账号、密码、限流、时钟、私有秘密和会话            |
| 跨域/CSRF 失败          | Origin、HTTPS、Cookie、可信代理及前后端地址一致性                    |
| 上传失败/扫描超时       | 资产授权、单图大小/MIME、私有桶、签名入口、ClamAV 就绪与总超时       |
| AI 无引用或回答失败     | 来源公开状态、Outbox/Kafka/Inbox、索引维度、模型可达性和供应商响应   |
| 迁移失败                | 先备份并核对数据库状态/错误；不执行 reset/drop 或改历史 SQL 逃过检查 |

发布、备份与回滚见[部署教程](deployment.md)，提交安全见[公开仓库管理](repository-security.md)。
