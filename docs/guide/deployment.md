# Backend 部署、备份与恢复教程

当前 API 已上线，本文提供可复用流程；历史单次上线结果在 engineering/validation 中按日期记录。API 健康 200 只代表存活，完整验收还包括认证、数据库、私有存储、扫描、消息与真实 AI。

## 1. 环境规划

准备 Linux 匹配架构的 Node 22 或容器环境、PostgreSQL 17/pgvector、Kafka、S3-compatible 私有桶、ClamAV、HTTPS 入口、可达 Chat/Embedding。当前生产由 systemd 运行 API，基础设施独立；Compose 模板是另一种部署方式，不应混用现有数据库或启动第二套服务覆盖端口。

私有配置放在发布目录外，例如 `/opt/linji/private/backend.env`，限制文件权限。根据 `infra/backend.production.env.example` 填写真实值。两个认证秘密要独立随机；CORS Origin 和可信代理明确配置；生产 Kafka 使用适当 TLS/认证；只向反向代理开放 API 监听入口。

环境文件中的 secrets 不能进入 Git、容器镜像、前端 bundle、源码归档和验收日志。数据库、模型 Key 与存储账号使用最小权限。

## 2. 数据保护和发布评估

1. 记录当前源码/契约版本、服务定义、发布目录、迁移数量及关键基础设施配置。
2. 备份 PostgreSQL，同时保存对象存储数据与对应配置；只备份 SQL 不能恢复图片。
3. 在隔离恢复库或生产克隆验证新迁移、数据兼容和关键 HTTP；不对原库运行集成测试。
4. 判断数据库变化是否能兼容旧代码。破坏性变更应设计扩展→迁移→收缩阶段，不能承诺仅换代码即可回滚。

2026-11-12 图片数量更新没有数据库迁移；后续变更不能沿用这个结论。

## 3. 构建

Node/systemd 方式在 Linux 独立副本中：

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm check
pnpm test:e2e
pnpm build
pnpm openapi:generate
```

将检查后的 dist、生产依赖和必要运行元数据放入新的 release 目录；保留 Prisma 运行引擎及与服务器匹配的依赖。迁移工具与 API 可分开部署，不把开发机 SDK 或 Windows node_modules 复制到 Linux。

容器方式提供 runtime 与 tools 两个 target：

```bash
docker build --target runtime -t linji/backend:RELEASE .
docker build --target tools -t linji/backend-tools:RELEASE .
```

将 RELEASE 替换为不可混淆的批次，发布时固定审核过的镜像 digest。镜像不包含真实 .env，构建阶段不要求连生产数据库。

## 4. 显式迁移与候选实例

Node 方式从受控私有环境运行 `pnpm db:deploy`，新环境才按需 seed/storage:init；已有生产数据不重复造种子数据。验证迁移前后状态与日志，失败时先调查，不重置数据库。

容器方式先在部署控制终端设置四个参数：

```bash
export BACKEND_IMAGE='linji/backend:RELEASE'
export BACKEND_TOOLS_IMAGE='linji/backend-tools:RELEASE'
export BACKEND_ENV_FILE='/opt/linji/private/backend.env'
export BACKEND_PORT='18080'
docker compose -f infra/compose.release.yml --profile tools run --rm migrate
docker compose -f infra/compose.release.yml up -d api
```

以上标签只供演示，实际应使用固定 digest。`compose.release.yml` 仅提供 API/tools，数据库/队列/存储/扫描需独立准备；容器中的 localhost 指当前容器，不是宿主或其他服务。

先在备用端口使用新 release 与隔离配置运行候选，检查 API/契约版本、认证、授权、内容、资产、队列和 AI，再切换正式 service。候选测试结束后关闭候选进程并清理专用资源，保留报告。

## 5. HTTPS 反向代理与 SSE

现有站点使用 `/snow-api/` 转到内部 API，路径示例：

```nginx
location /snow-api/ {
    proxy_pass http://127.0.0.1:18080/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_read_timeout 180s;
    client_max_body_size 12m;
}
```

这里尾斜杠将 `/snow-api/` 替换为 `/`，公开 `/snow-api/api/v1/...` 到内部 `/api/v1/...`。前端 Next basePath 的代理规则不同，不能一律加或去掉斜杠。

SSE 需关闭响应缓冲并容许模型延迟；客户端取消要传到服务端。Origin/CSRF 和 Cookie 规则必须按实际 HTTPS 域名验证。上传在 Nginx 与应用各层都有预算，调大反代上限不会取消单文件/正文/JSON 的服务端限制。私有存储签名入口必须保留正确 Host、路径和 HTTPS。

修改前备份配置，`nginx -t` 后 reload。已有配置无问题时，发布 API 不需要改 Nginx。

## 6. 备份与恢复到新库

仓库提供加密备份工具，先看精确参数：

```bash
node --experimental-strip-types scripts/database-backup.ts --help
# 在已安全加载 DATABASE_URL 与 BACKUP_ENCRYPTION_KEY 的控制环境执行
pnpm db:backup --directory /opt/linji/private/backups/NEW_BATCH --pg-bin /usr/lib/postgresql/17/bin
```

BACKUP_ENCRYPTION_KEY 的要求、目录和 manifest 约束由脚本校验，密钥单独保管；工具不会替操作者打印凭证。NEW_BATCH 必须是新的绝对目录。将返回的 manifest 摘要在备份目录之外另行可信保存，备份文件复制到其他故障域。

恢复时 DATABASE_URL 必须指向明确的新数据库，不能是原业务库：

```bash
pnpm db:restore-new --directory /opt/linji/private/backups/KNOWN_BATCH --pg-bin /usr/lib/postgresql/17/bin --manifest-sha256 <外部可信摘要> --confirm-target <新库名>
```

尖括号需替换实际值，密钥与 URL 通过私有环境传入。工具先认证完整备份，再创建新库；不会覆盖、drop、clean 或自动重试已有目标。失败后保留新目标供检查，不直接删除。恢复后执行数据库校验和业务验收，确认对象存储与数据库引用配套，再决定是否切换。

## 7. 回滚与运行验收

仅代码变化且数据库兼容时，恢复旧 service/镜像或 release 目录，重启并核对存活、认证、业务与重启次数。迁移已改变数据时，需要事先评估的恢复/前向修复流程；旧代码回滚不等于数据库回滚。

上线记录至少包括提交号、契约版本/SHA、迁移计划、产物摘要、备份位置（不含密钥）、切换时间、候选/正式验收、旧版本与回滚命令。

监测 API 错误率/延迟、数据库连接与磁盘、备份恢复成功率、Outbox 积压/失败、consumer 重试、扫描签名更新、私有对象可达性、证书到期、模型超时和费用。真实生产日志脱敏并留在私有环境。

## 8. 当前模型运行限制

现有 BGE-M3 在本机 Windows 运行，通过受控反向隧道接入服务器。`D:/linji-real-rag` 中包含仍在运行的模型/工具，`D:/linji-local` 包含监督脚本与发布材料；不能当作普通临时目录随意移动。开发机休眠/关机/断网会影响语义检索，应长期规划服务器独立模型或可靠托管 Embedding，验证维度、分块、重试与容量。

当前 GitHub 工作流不自动部署。远程 Actions、物理设备、容量与联合灾备的结果均需单独确认，不从一次构建成功推断。
