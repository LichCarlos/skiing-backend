# Backend 独立容器与发布准备

日期：2026-11-02。只涉及 Backend 的工程交付；现行 OpenAPI 1.50.0 / 143 操作、数据库结构和业务规则保持。本说明不能替代生产环境验收。

## 镜像与构建边界

[Dockerfile](../../Dockerfile) 的两个最终目标：

| 目标    | 用途                               | 内容与入口                                                               |
| ------- | ---------------------------------- | ------------------------------------------------------------------------ |
| runtime | 常驻 Nest HTTP / 后台任务          | 编译产物、生产依赖和 Linux Prisma；node 用户；`node dist/main.js`        |
| tools   | 单次迁移、seed、结构校验等运维命令 | 同次构建的源码、Prisma CLI、tsx 和脚本；node 用户；默认 `pnpm db:deploy` |

基础镜像为官方 Node 22 / Debian bookworm slim，多平台 index 固定为 `sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da`，2026-11-02 从 Docker Hub 查询。实际 CPU 架构和 Node 补丁版本以验收记录为准；该摘要不会随标签自动更新，应定期评估安全更新并重验。Debian 安装 CA/OpenSSL，Linux 内生成 Prisma，避免复制 Windows 引擎。

pnpm 固定 11.25.0，冻结本仓 lockfile；依赖缓存只用于加速。系统包源仍随 Debian 仓库变化，不宣称逐字节可复现。[.dockerignore](../../.dockerignore) 使用输入白名单，排除宿主依赖、Git、环境文件、日志和测试；运行镜像不复制源码、迁移工具或初始化密码。

在独立 Backend 仓库根目录：

```powershell
docker build --target runtime -t linji/backend:validation .
docker build --target tools -t linji/backend-tools:validation .
```

需要网络代理时只使用 Docker 标准代理参数，不写入 Dockerfile 或运行镜像 ENV，不将 API 密钥作为 build argument。两次构建须使用相同源码和锁文件；正式镜像构建后记录各自 image digest、源码提交和 OpenAPI hash。当前没有推送到镜像仓库。

## 发布配置与顺序

[生产环境模板](../../infra/backend.production.env.example) 只提供变量目录与占位值。[发布 Compose](../../infra/compose.release.yml) 只启动 API，依赖 PostgreSQL/pgvector、Kafka、私有对象存储、ClamAV 和 HTTPS 入口均由部署环境提供。原有 [开发依赖 Compose](../../infra/docker-compose.yml) 继续单独使用；不能将其 localhost 地址直接搬进应用容器。

把真实环境文件放到代码仓库外并限制文件读取权限，由部署平台注入密钥。运行环境不需要 INITIAL_ADMIN_PASSWORD；首次引导管理员使用额外的受控单次工具环境文件，完成后撤销凭证。seed 不重置已存在账号密码，密码修改使用既定账号管理流程。

为 Compose 提供以下非业务变量（可放到仓库外 release.env）：

```dotenv
BACKEND_IMAGE=registry.example.com/linji/backend@sha256:REPLACE_RUNTIME_DIGEST
BACKEND_TOOLS_IMAGE=registry.example.com/linji/backend-tools@sha256:REPLACE_TOOLS_DIGEST
BACKEND_ENV_FILE=/absolute/private/backend.env
BACKEND_PORT=8080
```

两个镜像变量都必须提供，Compose 在解析时也会展开 tools profile。路径使用运行 Compose 的宿主机绝对路径。以下命令是待部署方执行的流程，不表示已经发布：

1. 先完成数据库备份及恢复可用性核对，审查本次迁移的兼容性。工具账号需要迁移权限；常驻 API 使用受限业务账号，避免共用数据库超级用户。
2. `docker compose --env-file /absolute/private/release.env -f infra/compose.release.yml run --rm migrate`：先执行单次迁移，失败时停止发布。
3. 使用工具环境文件执行 `pnpm db:seed` 同步权限目录；首次引导时额外提供管理员凭证。随后 `pnpm db:verify`；这两个命令可作为 `run --rm migrate` 后面的命令覆盖。不要让每个 API 副本启动时竞争迁移/seed。
4. `docker compose --env-file /absolute/private/release.env -f infra/compose.release.yml up -d api`。API 使用非 root、只读根文件系统、独立 `/tmp`、移除 capabilities 和 no-new-privileges，端口只绑定回环供本机反向代理使用。
5. 核对进程存活、真实 API/数据库、Kafka 消费与 Outbox、S3/扫描器和模型依赖，再放行流量。`/api/v1/health` 仅代表进程存活；Docker unhealthy 不自动重启容器，不能把它作为全依赖就绪证明。

初始模板的模型 ID 是待核验项；不得把预期的 DeepSeek v4.1-flash 名称当成已验证供应商能力。Embedding 须满足现有 BGE-M3 / 1024 维检索空间，变更模型需要版本与重建策略。API 密钥不进入 Web/App。

Kafka 适配器后续已补齐 [TLS/SASL 与私有 CA/mTLS 配置](kafka-transport-security.md)，生产模板默认 TLS 与 SCRAM-SHA-512；真实集群安全连接仍待验收。使用私有 PEM 时必须提供容器内只读挂载和 node 用户读取权限，当前发布 Compose 不内置任何证书或真实凭证。存储必须允许公网签名地址直接访问私有桶对象；API 内部 endpoint 和浏览器 public endpoint 分别配置。浏览器 Cookie/CSRF 的 Origin、同站不同 Origin、独立 Cookie 空间等条件见已确认的平台适配说明，HTTPS 反向代理与流式 SSE 超时仍须单独验收。

## 信号与恢复边界

Compose 开启 init；命令直接运行 Node，SIGTERM 可以到达 Nest 的 enableShutdownHooks。默认 180 秒退出宽限用于后台任务与 HTTP/SSE 排空，需结合供应商超时、批量处理和实际负载调整，不保证所有任务一定在该期限内结束。超期 SIGKILL、主机故障及重放仍依赖既有 Outbox/Inbox/租约规则。详见 [停机生命周期](worker-shutdown.md)。

数据库回滚不能仅回退应用镜像；本项目 Prisma migrate deploy 不提供自动 down migration。生产需先设计兼容升级、备份恢复及恢复点，当前未演练。Compose 也未提供多 broker、TLS 证书管理、跨机灾备和告警。

## 可重复的本地验收

[验收脚本](../../scripts/validate-container.ts) 由 `pnpm test:container` 执行。无需外部 DATABASE_URL；脚本只使用自己新建的 PostgreSQL、Docker network、容器、随机账号和临时环境文件。可设 LINJI_CONTAINER_VALIDATION_DIR 将日志放到空间充足的盘，两个 image 环境变量默认对应上面的 validation 标签。

它执行 tools 镜像的 23 迁移、两次 seed 和结构校验，再启动只读非 root 的 runtime；检查私有工具/宿主环境没有进入 runtime、Prisma Linux 加载、公开数据与未授权拒绝。随后在实际 PostgreSQL 持有 User 表锁，确认登录请求正在等待数据库后发送 Docker SIGTERM；要求退出前完成请求和 session 写入，退出码 143 且没有 OOM/SIGKILL，重启同容器后原 access token 仍可查询本人。

验收不注入产品测试路由、不替换数据库驱动。为控制依赖范围，关闭 Kafka consumer 和 Outbox 派发，不调用外部模型/对象存储；后台消息在途排空仍使用此前真实 Kafka 的 app.close 证据，不能将本专项扩展成所有后台任务的 OS 信号验收。

清理前按完整 ID、名称和专用标签核对，仅回收本脚本创建的容器/匿名卷/network；保存脱敏报告和日志并移除临时环境文件。[专用 CI](../../.github/workflows/container.yml) 执行相同构建/验收且只归档报告；不推送镜像。远程 CI 尚未执行。

## 当前结果

后续状态：用户已选择“暂不重启，保留容器验收待办”。Docker重启不在当前授权范围；引擎有界查询仍超时，应用镜像/容器专项继续未验。接续进行的[DDD内层依赖修复](ddd-boundary-validation.md)不改变这一状态。

三仓冻结安装均通过；Backend 完整 check 的 131 文件 / 1048 单测与宿主 build 通过；最终验收脚本的 typecheck/lint 通过。Web 完整 1459 项及两个应用构建通过（构建缓存命中）；App 最终 56 文件 / 998 项、Doctor 20/20 及三平台导出通过，产物位于 `D:/linji-container-build/20261102/app-export`。三份 OpenAPI SHA-256 仍一致：`adaa39927fab990393b5d9213cf81eebea2f500d456aa93deefa006cb79d40c0`。

本次容器实测**未通过验收**，具体环境过程如下：

- Docker Hub 元数据经本机已有代理可查，但 daemon 拉取 Node 压缩层持续缓慢。通过同一官方 Registry 下载原始 index、amd64 manifest、config 和各层，逐项核对 SHA-256；额外核对解压后的 diff_ids，构造本地 Docker archive 后导入，未换第三方镜像、关闭 TLS 或校验。原始 index/manifest 摘要与 Dockerfile 一致，导入 image ID 为 `sha256:c469fbffcbb0086ddfb92598192d3e09eab25f2d81b9750a00f77f0910fed744`，材料保存在 `D:/linji-container-build/20261102/`。
- 本机 Docker load 不支持 `--platform`，也不能直接导入 OCI archive；保留失败结果后使用上述经典 Docker archive。BuildKit 按 index 摘要仍继续拉层，因此本地复验通过 NODE_IMAGE 覆盖为已经核对 image ID 的 `node:22-bookworm-slim`，基础镜像内容相同。正式构建默认仍使用固定 index；使用离线覆盖时必须先独立验证本地镜像的内容，不能任意用浮动标签替代摘要。
- Linux CA/OpenSSL 和 pnpm 安装已完成；冻结依赖安装下载到 434/467 包后，pnpm 的 fetch failed 中断，镜像尚未生成。供应链策略校验已通过，没有关闭该检查。随后把下载并发降到 4 后尝试复验，但 Docker 引擎已持续无响应，连 docker version 都不能完成，故停止本轮挂起的构建/查询 CLI，未重启 Docker 或停止其他项目容器。
- 并行前端检查时 App Vitest / PowerShell 出现内存不足；单 worker 重跑完整 App check 后通过。后端类型检查也出现 V8 内存不足；临时 512 MiB 堆限制不足，改为 1536 MiB 后 typecheck/lint 通过。未改变测试内容、类型约束或项目脚本的堆设置。宿主机已有其他项目进程占用大量内存，未结束它们。

本阶段未运行 `pnpm test:container`、未创建其数据库/账号/network/容器或临时环境文件；runtime/tools 镜像、23 迁移在容器内执行、只读启动、SIGTERM 及重启认证均仍待实测。现有历史 PostgreSQL/Kafka 证据不替代这些项目。独立 CI 已写入，远程未运行；没有发布或推送。

保留各仓被忽略的 `container-*.log`（含失败和复验），构建上下文及源文件留在本仓。Expo Web 浏览器、原生设备、供应商和生产发布仍独立待验。
