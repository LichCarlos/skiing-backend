# 从空白电脑到三端运行与部署

维护日期：2026-11-19。三个仓库都附带本手册，可在任一仓库单独阅读。命令分为 Windows PowerShell 与 Ubuntu Bash；不要混用语法。示例目录可改，但三个仓库分别安装依赖，不能在共同父目录运行 `pnpm install`。

本手册依据当前清单、锁文件、环境模板、Compose、Prisma、Next standalone 与 Expo 配置核对。它不依赖原作者的 D/E 盘、私有账号、模型隧道或未提交脚本。云账号、域名、模型服务和签名须由部署者准备；没有这些条件的阶段有明确停止点。文档核对不等于已在每一种空白电脑重新完成全流程验收。

## 0. 先决定要运行到哪一步

| 阶段             | 需要准备                                              | 可以验收的结果                                      |
| ---------------- | ----------------------------------------------------- | --------------------------------------------------- |
| A：页面学习      | Git、Node、pnpm、浏览器                               | Web/Admin/App Web 可启动；没有 API 时数据请求会失败 |
| B：完整普通业务  | A + Docker、PostgreSQL/pgvector、Kafka、MinIO、ClamAV | API、账号、权限、内容、上传与审核联调               |
| C：AI 与知识检索 | B + 有效 Chat、1024 维 Embedding、索引来源与 consumer | AI SSE、历史、引用与索引更新                        |
| D：互联网部署    | B/C + Linux、域名、DNS、TLS、Nginx、备份              | 独立服务器上通过 HTTPS 使用三端                     |
| E：移动安装包    | 可达的 HTTPS API、Expo/EAS 账号、应用 ID 与签名       | Android APK/AAB；iOS 还需 Apple 身份与相应分发资格  |

推荐顺序：**环境 → API/数据库 → 官网与管理端 → 上传审核 → AI → App → Linux 发布 → 备份恢复**。生产数据不随 Git 克隆，空数据库列表为空是正常状态。

```mermaid
flowchart LR
  W[官网 3000 / 管理端 3001] --> A[API 8080]
  M[Expo / Android / iOS] --> A
  A --> P[(PostgreSQL 17 + pgvector)]
  A --> S[私有 S3 / MinIO + ClamAV]
  A --> O[Outbox → Kafka → Inbox]
  O --> E[Embedding 1024 维]
  E --> P
  A --> C[Chat 模型服务]
```

## 1. 硬件、版本与官方下载

本地完整开发建议 Windows 11 64 位、CPU 虚拟化开启、16 GB 内存、80 GB 可用磁盘；同时运行 Android 模拟器和模型建议 32 GB 以上。Linux 单机学习部署建议 Ubuntu 24.04 LTS x86_64、4 vCPU / 8 GB / 60 GB 起，不包含本地大模型和实际媒体容量。这是入门预算，生产容量需按负载测量。

| 项目                    | 本教程基线 / 版本来源                                                                   | 下载、安装说明                                                                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git                     | 2.47+，不参与业务运行时                                                                 | [Windows 安装](https://git-scm.com/downloads/win)、[各平台安装](https://git-scm.com/downloads)                                                                                                |
| Node.js                 | **22.16.0** 复现基线；三仓 engines 要求 >=22.14.0                                       | [22.16.0 全平台文件](https://nodejs.org/dist/v22.16.0/)、[Windows x64 MSI](https://nodejs.org/dist/v22.16.0/node-v22.16.0-x64.msi)、[校验和](https://nodejs.org/dist/v22.16.0/SHASUMS256.txt) |
| pnpm                    | **Web 11.19.0；Backend/App 11.25.0**                                                    | 随 Node 的 npm 安装；[pnpm 官方说明](https://pnpm.io/installation)                                                                                                                            |
| Docker                  | Desktop 4.40+ 或 Engine 28+；Compose plugin 2.34+，Linux containers                     | [Windows/WSL2](https://docs.docker.com/desktop/setup/install/windows-install/)、[Ubuntu Engine](https://docs.docker.com/engine/install/ubuntu/)                                               |
| 编辑器                  | VS Code 当前稳定版，可选                                                                | [官方下载](https://code.visualstudio.com/download)                                                                                                                                            |
| 浏览器                  | 当前 Chrome/Edge/Firefox；App Web 需 Web Locks 与安全上下文                             | [Chrome](https://www.google.com/chrome/)、[Edge](https://www.microsoft.com/edge/download)                                                                                                     |
| PostgreSQL              | **17** + pgvector，镜像 `pgvector/pgvector:pg17`                                        | [pgvector](https://github.com/pgvector/pgvector)、[镜像](https://hub.docker.com/r/pgvector/pgvector)                                                                                          |
| Kafka                   | **4.1.1**，镜像 `apache/kafka:4.1.1`                                                    | [官方镜像](https://hub.docker.com/r/apache/kafka)                                                                                                                                             |
| MinIO                   | 源码 commit `9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a`                                  | 仓库 `infra/minio/Dockerfile` 校验源码并构建；无需宿主安装 Go                                                                                                                                 |
| ClamAV                  | **1.4.3**，镜像 `clamav/clamav:1.4.3`                                                   | [官方镜像](https://hub.docker.com/r/clamav/clamav)，首次需下载病毒库                                                                                                                          |
| Android（本地构建才装） | JDK **21**；SDK **37**；Build Tools **37.0.0**；NDK **27.1.12297006**；CMake **3.22.1** | [Temurin 21](https://adoptium.net/temurin/releases/?version=21)、[Android Studio/SDK](https://developer.android.com/studio)                                                                   |
| Expo 原生工具链         | SDK **58** / RN **0.88.1**；生成的 Gradle Wrapper **9.4.1**                             | [SDK 58 文档](https://docs.expo.dev/versions/v58.0.0/)；Gradle 由 Wrapper 下载，不另装全局 Gradle                                                                                             |
| iOS（本地构建才装）     | macOS + 与 SDK 58 兼容的 Xcode/模拟器                                                   | [Xcode 官方下载](https://developer.apple.com/xcode/)、[Expo iOS 环境](https://docs.expo.dev/get-started/set-up-your-environment/)                                                             |

JS 依赖版本由各仓 `pnpm-lock.yaml` 固定，不能重新生成锁文件来“解决安装”。主机工具采用上述能力下限；镜像中 `pg17` 等标签可能更新，严格复现时记录拉取后的 `RepoDigests` 并固定审核过的 digest。Node 22.16.0 是现有仓库复现基线，公开生产使用仍受支持的最新 22.x 安全补丁，并完成同样检查；不要直接跨到未验证的 Node 大版本。

### 1.1 Windows：安装基础工具

1. 安装 Git for Windows，选择允许命令行调用 Git。
2. 安装上表 Node MSI，包含 npm 并加入 PATH。不要并存多个来源不明的 Node 安装。
3. 以管理员 PowerShell 执行 `wsl --install -d Ubuntu-24.04`，按提示重启并完成 Linux 用户初始化；已有 WSL 则先检查 `wsl --status`、`wsl --list --verbose`，发行版应为版本 2。
4. 安装 Docker Desktop，选择 WSL2 / Linux containers，启动并等引擎就绪。[Docker 系统条件](https://docs.docker.com/desktop/setup/install/windows-install/#system-requirements)还包括 BIOS 虚拟化和受支持系统版本。
5. 重开普通 PowerShell，检查：

```powershell
git --version
node --version
npm --version
npm install --global pnpm@11.25.0
pnpm --version
docker version
docker compose version
docker run --rm hello-world
```

`docker version` 必须同时出现 Client 和 Server。网络需能访问 GitHub、npm、Docker Hub、Go modules、Google Maven、Expo 等相应阶段的下载站。受限网络配置正式代理或可信镜像；不关闭 TLS 校验，也不替换为不明二进制。

如 PowerShell 禁止 `pnpm.ps1`，使用 `pnpm.cmd`、`npm.cmd` 执行同一命令，无需降低整个系统执行策略。若 `where.exe node` 指向多份安装，先修正 PATH。Windows 与 WSL 的 `node_modules` 不能共用：在哪个系统安装就在哪个系统运行。

可从下载页获取 `SHASUMS256.txt` 后用 `Get-FileHash .\node-v22.16.0-x64.msi -Algorithm SHA256` 对照；确认来源后再安装。

### 1.2 Ubuntu 24.04：Node、Git 与 Docker

以下命令用于新建的 Ubuntu 主机（Bash），需有 sudo 权限：

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git xz-utils openssl
mkdir -p "$HOME/linji-downloads"
cd "$HOME/linji-downloads"
curl -fLO https://nodejs.org/dist/v22.16.0/SHASUMS256.txt
curl -fLO https://nodejs.org/dist/v22.16.0/node-v22.16.0-linux-x64.tar.xz
sha256sum --check --ignore-missing SHASUMS256.txt
sudo tar -xJf node-v22.16.0-linux-x64.tar.xz -C /usr/local --strip-components=1
node --version
sudo npm install --global pnpm@11.25.0
```

ARM64 主机将文件名的 `linux-x64` 改为 `linux-arm64`；构建、依赖及发布主机架构必须匹配。此安装方式用于无 Node 的新机，已有 Node 先查 `command -v node`，不要覆盖其他项目的运行时。

按 Docker 官方 apt 仓库安装 Engine 与 Compose：

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
```

Linux 后文普通用户的 `docker` 命令需具备访问引擎的权限。可继续使用 `sudo docker ...`；专用开发机也可按官方说明将操作者加入 docker 组后重新登录。docker 组拥有近似 root 的能力，不随意授予服务器普通账号。

## 2. 克隆三个独立仓库

Windows PowerShell：

```powershell
New-Item -ItemType Directory -Force D:\projects\linji | Out-Null
Set-Location D:\projects\linji
git clone https://github.com/LichCarlos/skiing-backend.git
git clone https://github.com/LichCarlos/skiing-web.git
git clone https://github.com/LichCarlos/skiing-app.git
```

Linux/macOS Bash：

```bash
mkdir -p "$HOME/projects/linji"
cd "$HOME/projects/linji"
git clone https://github.com/LichCarlos/skiing-backend.git
git clone https://github.com/LichCarlos/skiing-web.git
git clone https://github.com/LichCarlos/skiing-app.git
```

三个目录互为同级，名字不影响业务；没有 D 盘时 Windows 可改到 `C:\projects\linji`。后续每段注明当前工作目录。源码/依赖/产物归所属仓库，SDK 可独立安装，不在盘符根生成实体构建目录，不复制作者的私有 runtime。

## 3. 启动 Backend 与基础设施

### 3.1 依赖与本地配置

当前目录：`skiing-backend`。先 `cd` 进入该目录，再执行：

```bash
npm install --global pnpm@11.25.0
pnpm --version
pnpm install --frozen-lockfile
```

PowerShell：`Copy-Item .env.example .env`；Bash：`cp .env.example .env`。不要覆盖已有私有 `.env`。编辑该文件，保留模板其他配置，至少填写下面这些键：

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/linji_snow
JWT_ACCESS_SECRET=REPLACE_WITH_FIRST_RANDOM_HEX
LOGIN_RATE_LIMIT_SECRET=REPLACE_WITH_SECOND_RANDOM_HEX
INITIAL_ADMIN_ACCOUNT=your-local-admin
INITIAL_ADMIN_PASSWORD=REPLACE_WITH_YOUR_OWN_PASSWORD
WEB_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:8081
S3_ACCESS_KEY_ID=linji-local
S3_SECRET_ACCESS_KEY=REPLACE_WITH_YOUR_STORAGE_PASSWORD
KAFKA_CONSUMER_ENABLED=false
OUTBOX_DISPATCH_ENABLED=true
```

每个 `REPLACE_...` 都必须替换。两次运行下面命令生成两个不同秘密，分别填入两个认证键；不把输出提交 Git：

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

数据库 `postgres/postgres` 仅为本机隔离开发默认；生产另设凭证。初始管理员密码按应用规则使用 8—72 个 UTF-8 字节，建议足够长的随机密码。新环境可在 `.env` 加 `POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB` 并同步改 `DATABASE_URL`。URL 密码里的 `@`、`:`、`#`、`/` 等需百分号编码，建议使用随机十六进制避免解析问题。已初始化 Docker 卷后改 POSTGRES_PASSWORD 不会自动修改库内密码。

### 3.2 启动、观察就绪并创建 topic

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
docker compose --env-file .env -f infra/docker-compose.yml ps
docker compose --env-file .env -f infra/docker-compose.yml logs --tail 80 postgres kafka minio clamav
docker compose --env-file .env -f infra/docker-compose.yml exec postgres pg_isready -U postgres -d linji_snow
docker compose --env-file .env -f infra/docker-compose.yml exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --create --if-not-exists --topic linji.integration-events --partitions 3 --replication-factor 1
```

改过数据库用户名/库名时同步修改 `pg_isready` 参数。Postgres/Kafka 应 healthy，MinIO 日志应显示 API 已启动，ClamAV 应完成病毒库更新并启动 clamd。`up -d` 返回不代表扫描器就绪；Go 源码编译与病毒库首次下载可能耗时数分钟或更久。MinIO 构建依赖固定 Go 镜像和源码归档；网络错误先看 `--progress plain` 构建日志，不改 checksum 绕过验证。

| 服务           | 本机端口    | 作用 / 访问                       |
| -------------- | ----------- | --------------------------------- |
| API            | 8080        | NestJS，后面启动                  |
| PostgreSQL     | 5432        | 包含 vector 扩展的数据库          |
| Kafka          | 9092        | 业务事件与索引队列                |
| MinIO          | 9000 / 9001 | S3 API / 控制台；账号对应 S3 配置 |
| ClamAV         | 3310        | 文件扫描 TCP，不是网页            |
| 官网 / 管理端  | 3000 / 3001 | 两个独立 Next 进程                |
| Expo Web/Metro | 通常 8081   | 以终端实际 URL 为准               |

端口被占用时先查所属进程。更改 Compose 端口必须同步数据库/模型/存储等相应 URL，不停止其他项目。后端在宿主运行，所以本地模板中的 `localhost` 正确；将后端放容器后这些地址必须改为容器可达地址。

### 3.3 初始化数据库、私有桶与 API

```bash
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm exec tsx --env-file=.env scripts/verify-database.ts
pnpm storage:init
pnpm start:dev
```

`db:generate` 生成 Client，`db:deploy` 应用已提交迁移，`db:seed` 同步内置权限/角色并按配置创建管理员，**不会导入线上雪场和文章**。校验脚本直接使用 Prisma，教程显式传 `--env-file=.env`，不依赖当前终端已加载变量；`pnpm db:verify` 可在 DATABASE_URL 已提供的环境中使用。迁移/seed 由 Prisma 配置读取 `.env`，storage:init 与 Nest 启动也自行读取。

另开终端验证（PowerShell 可将 `curl` 写为 `curl.exe`）：

```bash
curl --fail http://localhost:8080/api/v1/health
curl --fail http://localhost:8080/api/docs-json
```

浏览器访问 `http://localhost:8080/api/docs` 查看 Swagger。健康检查仅表示进程可响应；接着需要真实登录、读写和上传验收。

## 4. 官网与桌面管理端

当前目录：`skiing-web`。这里 pnpm 与其他两仓不同：

```bash
npm install --global pnpm@11.19.0
pnpm --version
pnpm install --frozen-lockfile
```

复制根 `.env.example` 为根 `.env`，配置：

```dotenv
NEXT_PUBLIC_WEB_API_BASE_URL=http://localhost:8080/api/v1
NEXT_PUBLIC_ADMIN_API_BASE_URL=http://localhost:8080/api/v1
NEXT_PUBLIC_WEB_SITE_ORIGIN=http://localhost:3000
NEXT_PUBLIC_WEB_BASE_PATH=
NEXT_PUBLIC_ADMIN_BASE_PATH=
```

两个终端都在 Web 仓库根目录，分别执行：

```bash
pnpm dev:web
```

```bash
pnpm dev:admin
```

访问 `http://localhost:3000` 与 `http://localhost:3001`。管理员账号使用上一步自己填写并 seed 的值。新库不带示例内容：登录管理端创建雪场、分类、文章，再在官网查看；动态需按审核流程公开。导航只显示获授权功能，服务端仍逐请求鉴权。

浏览器认证使用 Secure Cookie/CSRF。开发先统一使用 **localhost**（现代浏览器对 localhost 有特殊支持），不要混用 127.0.0.1、局域网 HTTP 和不同 host。若浏览器拒绝 Secure Cookie，按第 7 节建立可信 HTTPS 开发入口；不要删除 Cookie 安全标志。管理端不需要手机布局适配。

`NEXT_PUBLIC_*` 都是公开构建变量。生产要改域名与路径时必须重新 build，不能只修改运行进程的环境变量。前端不接收数据库密码、JWT secret 或模型 Key。

## 5. 先完成一次普通业务闭环

1. 使用初始化管理员登录管理端；确认账号、角色、权限和按身份显示的左侧菜单。
2. 在字典中选择可配置类别并创建选项；字段管理维护既有实体的扩展字段，不任意建 SQL 表。
3. 新建并公开一个测试雪场、一篇知识文章；官网列表与详情能读到它们。
4. 用独立普通账号登录，上传一张正常图片并发布社区动态；管理端审核后公开。MinIO 桶保持私有，文件需经 ClamAV 扫描。
5. 普通账号访问管理 API 应被拒绝；只隐藏菜单不能代替后端授权。

每篇文章没有固定图片张数上限，单文件大小、资产归属、扫描、正文长度和传输预算仍适用。先用少量文件验证，再逐步测试较大内容。

## 6. AI 与知识库：在普通业务之后开启

### 6.1 两种模型分别准备

Chat 负责生成回答，Embedding 负责检索与索引，**一个 Chat Key 不会自动提供可用向量服务**。本项目固定使用 **1024 维**向量；模型名、维度及旧索引必须匹配。推荐准备提供 BGE-M3 1024 维、OpenAI-compatible `/embeddings` 的托管服务，先省去本地模型部署；也可自行运营同协议服务。

官方下载/服务入口示例：[DeepSeek API 文档](https://api-docs.deepseek.com/)、[BGE-M3 模型](https://huggingface.co/BAAI/bge-m3)、[llama.cpp](https://github.com/ggml-org/llama.cpp)、[Hugging Face TEI](https://huggingface.co/docs/text-embeddings-inference/index)。下载原始模型文件还需要推理服务、正确模型格式和池化配置，不能只把文件路径写进 EMBEDDING_BASE_URL。不同推理引擎的版本/硬件兼容须按其官方部署文档验证；本教程的最小完整 AI 路径使用已提供兼容 HTTPS API 的服务，不要求某款 GPU。

编辑 Backend `.env`：

```dotenv
CHAT_MODEL_BASE_URL=https://YOUR_CHAT_PROVIDER/v1
CHAT_MODEL_API_KEY=YOUR_PRIVATE_CHAT_KEY
CHAT_MODEL_NAME=YOUR_AVAILABLE_CHAT_MODEL_ID
CHAT_MODEL_THINKING=
CHAT_MODEL_TIMEOUT_MS=120000
EMBEDDING_BASE_URL=https://YOUR_EMBEDDING_PROVIDER/v1
EMBEDDING_API_KEY=YOUR_PRIVATE_EMBEDDING_KEY
EMBEDDING_MODEL=BAAI/bge-m3
EMBEDDING_TIMEOUT_MS=30000
KAFKA_CONSUMER_ENABLED=true
OUTBOX_DISPATCH_ENABLED=true
```

上述 `YOUR_...` 均换为自己供应商实际值；模型 ID 以自己账号的可用模型列表为准，不保证模板中的 `deepseek-flash` 对所有账号可用。适配器在 base URL **直接追加** `/chat/completions` 或 `/embeddings`：若供应商地址已经含 `/v1`，就保留一次，不能重复追加；DeepSeek 的根域协议则按其文档配置。非 DeepSeek 服务通常留空 CHAT_MODEL_THINKING。服务端可用 loopback HTTP；远程服务和生产建议使用 HTTPS。

### 6.2 验证、公开来源与索引

当前目录：`skiing-backend`，使用 pnpm 11.25.0：

```bash
pnpm ai:verify --help
pnpm ai:verify --all
pnpm rag:reindex -- --help
```

`--all` 会实际调用模型，可能产生供应商费用，不是离线检查。应看到 Chat 和 Embedding 都 passed；Embedding 应返回 1024 个有限数值。修改配置后重启 API。

在管理端创建/公开知识来源并观察 Outbox → Kafka → Inbox → 索引状态。新创建来源由事件驱动；既有数据按 reindex 的 `--help` 选择来源、检查点和批次后回填，不直接套用历史命令。使用官网个人中心的 AI 入口，验证流式回答、取消/重试、历史保存与已公开来源引用。空库无引用是正常情况。

AI 超时时按顺序查：供应商独立 smoke → Embedding 维度 → 来源公开状态 → topic/consumer → 索引 → API 日志 → 反代 SSE。当前作者环境曾使用本机模型反向隧道；新部署不要依赖该私有隧道或要求原作者电脑开机。

## 7. 从全新 Ubuntu 服务器发布整套 Web/API

本节给出**单机学习部署**的可执行路径：API 与 Next 在宿主运行，基础设施为本机 Docker，Nginx 提供统一 HTTPS。Kafka 单节点、共机数据库和存储不是高可用方案；正式规模化运行再按负载拆分和加固。此路径与 API-only `compose.release.yml` 是两种方案，不混用地址和网络。

### 7.1 主机、目录、DNS 与进程账号

按第 1.2 节安装 Node/Git/Docker。准备一个自己拥有的域名及其 `assets` 子域名，两者 A 记录均指向服务器公网 IP；若存在 AAAA，IPv6 也必须正确。下文示例 `REPLACE_DOMAIN` 是主站域名，`assets.REPLACE_DOMAIN` 是私有存储的签名访问域名。开放 SSH 与 80/443，其他业务端口不开放公网。

```bash
sudo apt-get install -y nginx certbot
sudo adduser --system --group --home /opt/linji linji
sudo install -d -o linji -g linji /opt/linji/src /opt/linji/releases /opt/linji/private
sudo chmod 700 /opt/linji/private
sudo -u linji git clone https://github.com/LichCarlos/skiing-backend.git /opt/linji/src/skiing-backend
sudo -u linji git clone https://github.com/LichCarlos/skiing-web.git /opt/linji/src/skiing-web
```

在新服务器启用防火墙前先确认 SSH 的真实端口；默认 22 的示例：

```bash
sudo apt-get install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw enable
sudo ufw status verbose
```

若 SSH 使用自定义端口，先允许该端口再启用，保留现有会话并另开会话确认能登录。云安全组也只放行相应 SSH 与 80/443；不要依赖 UFW 保护未限制绑定的 Docker 端口，后文显式将基础设施绑定到 loopback。

以下构建命令使用 `sudo -u linji -H bash` 进入服务账号的构建 shell，避免 root 所有的依赖和产物；需要 sudo 的系统配置另回管理员 shell。服务账号不需要 docker 组，容器由管理员启动。

### 7.2 私有环境与基础设施

当前目录：`/opt/linji/src/skiing-backend`。管理员复制 `.env.example` 到 `/opt/linji/private/backend.env`，按第 3 节替换所有秘密，另加以下单机配置：

```dotenv
NODE_ENV=production
PORT=8080
POSTGRES_USER=linji
POSTGRES_DB=linji_snow
POSTGRES_PASSWORD=YOUR_RANDOM_HEX_DATABASE_PASSWORD
DATABASE_URL=postgresql://linji:YOUR_RANDOM_HEX_DATABASE_PASSWORD@127.0.0.1:5432/linji_snow
POSTGRES_PORT=127.0.0.1:5432
KAFKA_PORT=9092
KAFKA_BROKERS=127.0.0.1:9092
S3_ENDPOINT=http://127.0.0.1:9000
S3_PUBLIC_ENDPOINT=https://assets.REPLACE_DOMAIN
S3_SERVER_SIDE_ENCRYPTION=false
MINIO_BIND_ADDRESS=127.0.0.1
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
WEB_ORIGINS=https://REPLACE_DOMAIN
TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128
```

`REPLACE_DOMAIN` 换成自己的域名，无协议；两个数据库密码位置用同一个随机十六进制密码。此 MinIO 没有 KMS，不能直接把 SSE=true 当作已具备加密能力；生产采用磁盘加密或配置支持 SSE/KMS 的存储后再启用。JWT/限流秘密、S3 账号/密码、初始管理员与模型配置也必须填写，模板的其他键仍保留。没有模型时先保持 consumer=false，按第 6 节逐项开启。

限制文件权限并让仓库 `.env` 指向私有文件，方便 Prisma/初始化工具读取：

```bash
sudo chown linji:linji /opt/linji/private/backend.env
sudo chmod 600 /opt/linji/private/backend.env
sudo -u linji ln -s /opt/linji/private/backend.env /opt/linji/src/skiing-backend/.env
```

本地 Compose 的 Kafka、ClamAV 默认端口映射较宽。**新服务器**部署时创建 `/opt/linji/private/loopback.yml`，内容如下。`!override` 需要 Compose 2.24.4+，本教程基线满足：

```yaml
services:
  postgres:
    ports: !override
      - "127.0.0.1:5432:5432"
  kafka:
    ports: !override
      - "127.0.0.1:9092:9092"
  minio:
    ports: !override
      - "127.0.0.1:9000:9000"
      - "127.0.0.1:9001:9001"
  clamav:
    ports: !override
      - "127.0.0.1:3310:3310"
```

管理员执行：

```bash
cd /opt/linji/src/skiing-backend
sudo docker compose --env-file /opt/linji/private/backend.env -f infra/docker-compose.yml -f /opt/linji/private/loopback.yml up -d --build
sudo docker compose --env-file /opt/linji/private/backend.env -f infra/docker-compose.yml -f /opt/linji/private/loopback.yml ps
sudo docker compose --env-file /opt/linji/private/backend.env -f infra/docker-compose.yml -f /opt/linji/private/loopback.yml exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --create --if-not-exists --topic linji.integration-events --partitions 3 --replication-factor 1
```

Docker 命名卷保存在 Docker 的 data root（Windows Desktop 在其 Linux 磁盘映像内），不是下载到源码仓库。可在新机安装时规划 Docker 数据盘；已有数据不要直接移动或改 data-root。项目代码、日志、发布包使用 `/opt/linji`；定期另做离机备份。

### 7.3 构建 API、初始化新库与 Web

进入服务账号 shell：

```bash
sudo -u linji -H bash
cd /opt/linji/src/skiing-backend
pnpm install --frozen-lockfile
pnpm db:generate
pnpm check
pnpm test:e2e
pnpm db:deploy
pnpm db:seed
pnpm exec tsx --env-file=.env scripts/verify-database.ts
pnpm storage:init
pnpm build
```

上面迁移/seed 仅用于**自己新建的库**。已有生产环境先按第 8 节备份、克隆验证，不能套用“空白机初始化”。API 使用此源码目录的 dist 与匹配 Linux 依赖运行；本路径为便于首次学习的单套部署，更新时创建新源码/release 目录，不在运行目录直接重装依赖。

当前系统全局 pnpm 为 11.25.0；Web 的 packageManager 声明为 11.19.0，可通过 pnpm 版本管理自动切换，若没有自动切换，用 `npx --yes pnpm@11.19.0 ...` 执行本仓同名命令。构建前 `pnpm --version` 应显示本仓版本。编辑 `/opt/linji/src/skiing-web/.env`：

```dotenv
NEXT_PUBLIC_WEB_API_BASE_URL=https://REPLACE_DOMAIN/snow-api/api/v1
NEXT_PUBLIC_ADMIN_API_BASE_URL=https://REPLACE_DOMAIN/snow-api/api/v1
NEXT_PUBLIC_WEB_SITE_ORIGIN=https://REPLACE_DOMAIN
NEXT_PUBLIC_WEB_BASE_PATH=/snow
NEXT_PUBLIC_ADMIN_BASE_PATH=/snow-admin
```

然后在服务账号 shell 构建（以下显式指定 Web pnpm，避免全局切换）：

```bash
cd /opt/linji/src/skiing-web
npx --yes pnpm@11.19.0 install --frozen-lockfile
npx --yes pnpm@11.19.0 check
npx --yes pnpm@11.19.0 build:web
npx --yes pnpm@11.19.0 build:admin
mkdir -p /opt/linji/releases/first
cp -a apps/web/.next/release /opt/linji/releases/first/web
cp -a apps/admin/.next/release /opt/linji/releases/first/admin
npx --yes pnpm@11.19.0 release:verify web /opt/linji/releases/first/web
npx --yes pnpm@11.19.0 release:verify admin /opt/linji/releases/first/admin
exit
```

`first` 用于首次发布且目标目录需未占用，后续换为自己的批次。Next build 自动生成 `.next/release`，其中包含 start.mjs、静态文件和必要依赖，不能只复制 `.next/server`。Linux 构建不使用 Windows node_modules。若构建过程需要抓取公开 API/元数据，确认该依赖已可达；不要把错误页当正式内容。

### 7.4 systemd 三个服务

管理员创建 `/etc/systemd/system/linji-api.service`：

```ini
[Unit]
Description=Linji API
After=network-online.target docker.service
Wants=network-online.target

[Service]
User=linji
Group=linji
WorkingDirectory=/opt/linji/src/skiing-backend
EnvironmentFile=/opt/linji/private/backend.env
ExecStart=/usr/local/bin/node /opt/linji/src/skiing-backend/dist/main.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=180
UMask=0077

[Install]
WantedBy=multi-user.target
```

创建 `/etc/systemd/system/linji-web.service`：

```ini
[Unit]
Description=Linji Web
After=network-online.target linji-api.service

[Service]
User=linji
Group=linji
WorkingDirectory=/opt/linji/releases/first/web
Environment=NODE_ENV=production
Environment=HOSTNAME=127.0.0.1
Environment=PORT=13100
ExecStart=/usr/local/bin/node /opt/linji/releases/first/web/start.mjs
Restart=on-failure
RestartSec=5
TimeoutStopSec=120

[Install]
WantedBy=multi-user.target
```

复制此文件为 `/etc/systemd/system/linji-admin.service`，将 Description 改为 Linji Admin、路径两处 `/first/web` 改为 `/first/admin`、PORT 改为 **13101**。如果 Node 不在 `/usr/local/bin/node`，按 `command -v node` 的绝对路径修改三个 unit。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now linji-api linji-web linji-admin
sudo systemctl status linji-api linji-web linji-admin --no-pager
curl --fail http://127.0.0.1:8080/api/v1/health
curl --fail http://127.0.0.1:13100/snow
curl --fail http://127.0.0.1:13101/snow-admin/login
```

API 当前代码 `app.listen(port)` 未提供仅监听 loopback 的环境键；因此在宿主防火墙/云安全组阻止公网 8080，不能误以为配置 HOST 已限制 API。仅对外开放 SSH 和 80/443，确认 IPv4/IPv6 规则都生效；Docker 发布端口已显式绑定 loopback。

### 7.5 证书与 Nginx：路径和 Cookie 必须一起处理

以下 `REPLACE_DOMAIN` 全部换为同一个真实域名。先创建 `/var/www/letsencrypt`，再创建 `/etc/nginx/sites-available/linji` 的初始 HTTP 配置：

```nginx
server {
    listen 80;
    server_name REPLACE_DOMAIN assets.REPLACE_DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
    location / { return 404; }
}
```

在新服务器启用站点并申请证书：

```bash
sudo mkdir -p /var/www/letsencrypt
sudo ln -s /etc/nginx/sites-available/linji /etc/nginx/sites-enabled/linji
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/letsencrypt -d REPLACE_DOMAIN -d assets.REPLACE_DOMAIN
```

域名必须能从公网解析到本机、80 可达；按提示填写邮箱并接受服务条款。拿到证书后将同一配置文件改为：

```nginx
server {
    listen 80;
    server_name REPLACE_DOMAIN assets.REPLACE_DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 443 ssl;
    server_name REPLACE_DOMAIN;
    ssl_certificate /etc/letsencrypt/live/REPLACE_DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/REPLACE_DOMAIN/privkey.pem;
    client_max_body_size 12m;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    location = / { return 302 /snow; }
    location = /snow { proxy_pass http://127.0.0.1:13100; }
    location /snow/ { proxy_pass http://127.0.0.1:13100; }
    location = /snow-admin { proxy_pass http://127.0.0.1:13101; }
    location /snow-admin/ { proxy_pass http://127.0.0.1:13101; }

    location /snow-api/ {
        proxy_pass http://127.0.0.1:8080/;
        proxy_cookie_path /api/v1 /snow-api/api/v1;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 180s;
        proxy_send_timeout 180s;
    }
    location / { return 404; }
}
server {
    listen 443 ssl;
    server_name assets.REPLACE_DOMAIN;
    ssl_certificate /etc/letsencrypt/live/REPLACE_DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/REPLACE_DOMAIN/privkey.pem;
    client_max_body_size 12m;
    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_request_buffering off;
        proxy_buffering off;
    }
}
```

解释三个容易出错的条件：

- **Next 保留前缀**：`proxy_pass ...:13100` 和 `...:13101` 后面不加 `/`，请求 `/snow/...`、`/snow-admin/...` 应原样进入 Next。
- **API 剥离前缀并重写 Cookie Path**：`...:8080/` 的尾斜杠将 `/snow-api/api/v1` 转成内部 `/api/v1`；后端 Cookie Path 为 `/api/v1` 和 `/api/v1/auth`，必须同步映射到外部 `/snow-api/api/v1...`，否则登录可能成功但下一次请求掉线。直接独立 API 域名、没有 `/snow-api` 前缀时不使用这条重写。
- **S3 保持签名 Host 和完整路径**：使用独立的 `https://assets.域名`，代理不添加或剥离路径前缀，保留 `$http_host`。S3 签名包含规范化路径，不能把已签名的 `/snow-assets/...` 去掉前缀后转给 MinIO，否则可能 SignatureDoesNotMatch。不对桶开启匿名访问，不把控制台 9001 公布到公网；当前上传通过 API，浏览器使用授权后的签名地址读图。若另加浏览器直传，需要独立配置桶 CORS 并实测。

```bash
sudo nginx -t
sudo systemctl reload nginx
curl --fail https://REPLACE_DOMAIN/snow-api/api/v1/health
curl --fail https://REPLACE_DOMAIN/snow
curl --fail https://REPLACE_DOMAIN/snow-admin/login
sudo certbot renew --dry-run
```

Certbot 的续期任务通常由安装包提供的 timer 执行，可用 `systemctl list-timers --all` 确认。使用 certonly/webroot 时增加 deploy hook，证书续期后让 Nginx 重读证书：

```bash
sudo install -d /etc/letsencrypt/renewal-hooks/deploy
sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx >/dev/null <<'HOOK'
#!/bin/sh
/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx
HOOK
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx
```

若发布 IPv6/AAAA，Nginx 的每个 server 还需相应 `listen [::]:80;` 或 `listen [::]:443 ssl;`，并验证 IPv6 路由/防火墙；不使用 IPv6 时删除错误 AAAA，避免部分设备连接失败。

在浏览器检查登录后刷新仍保持身份、上传/显示图片、管理端新建按钮、知识正文与 AI SSE。对有 `/snow-api` 前缀的 SSE 关闭缓冲，并保证代理超时大于模型预算。Nginx 12 MB 是代理预算，服务端仍有 JSON/单文件约束。

生产首次 seed 后移除私有运行文件中的 INITIAL_ADMIN_PASSWORD（同时移除 INITIAL_ADMIN_ACCOUNT），保留账号在密码管理器；重启验证。以后同步权限等维护应独立评估 seed 行为，不依赖启动时自动初始化。

## 8. 备份、更新和回滚

先读 Backend [备份工具教程](https://github.com/LichCarlos/skiing-backend/blob/main/docs/guide/deployment.md)。需要 **PostgreSQL 17 的 pg_dump/pg_restore/psql** 客户端；容器内的程序不等于宿主已有。按 [PostgreSQL Ubuntu 官方 apt](https://www.postgresql.org/download/linux/ubuntu/)安装 `postgresql-client-17`，用 `/usr/lib/postgresql/17/bin/pg_dump --version` 确认。

加密备份键为独立秘密，按工具 `--help` 的格式生成并单独备份，不能只与备份文件存在同一磁盘。当前目录为 Backend：

```bash
node --experimental-strip-types scripts/database-backup.ts --help
```

安全注入 DATABASE_URL 和 BACKUP_ENCRYPTION_KEY 后，按帮助执行备份到**新的绝对目录**。数据库和对象存储必须配套备份；Docker 卷、S3 对象、私有配置/证书、Android 签名均需自己的备份与恢复验证。`docker compose down -v` 会删卷，不能作为更新步骤。

发布顺序：记录提交/契约/产物摘要 → 离机备份 → 隔离恢复库验证 → 新目录冻结安装和构建 → 迁移兼容性评估 → 候选端口检查 → 切换对应 systemd unit → HTTPS 业务验收。前端回滚换回旧 release；API 回滚要求数据库兼容；破坏性迁移不能靠换回 JS 恢复数据。保留旧包、旧 unit 与发布记录。

## 9. App 从浏览器到 Android 安装包

### 9.1 先用 Expo Web 跑通 API

当前目录：`skiing-app`：

```bash
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm exec expo-doctor
```

复制 `.env.example` 为 `.env`，本机浏览器开发用 `EXPO_PUBLIC_API_BASE_URL=http://localhost:8080/api/v1`。后端 WEB_ORIGINS 加入 Expo 实际 Origin（默认常为 `http://localhost:8081`），重启 API。然后：

```bash
pnpm web
```

修改地址后重启 Metro；已发布的安装包需要重构建。原生 access token 在内存，refresh token 在 SecureStore；Web 使用 Cookie/CSRF。Chat/Embedding Key 不能放 EXPO_PUBLIC_*。

### 9.2 推荐：EAS 云构建 APK，不安装本地 SDK

准备 Expo 账号与可用 EAS 构建额度、自己的 EAS 项目、公开 HTTPS API 和应用 ID。iOS 不是 Android APK 的前置条件，但当前配置检查要求填写 iOS bundle identifier。只构建 Android 时选定未来自用的合法 iOS 标识即可，不需要先购买 Apple 会员。

```bash
npx --yes eas-cli@27.10.0 login
npx --yes eas-cli@27.10.0 whoami
npx --yes eas-cli@27.10.0 init
```

`init` 选择或创建**自己的项目**，记录 Expo dashboard 中的 Project ID 与 owner；当前动态 app.config.ts 不应被随意覆盖，CLI 若提示无法自动写动态配置，就按下面的环境变量绑定。EAS CLI 是外部交付工具，本教程固定为 npm 官方登记的 **27.10.0**（Node 要求 ^20.18.3 或 >=22.0.0，与本教程 Node 兼容）。云镜像不会被本仓锁文件固定，构建时仍需保存 CLI、云镜像和依赖版本；版本存在与引擎兼容不等于已用读者账号完成云构建。

在本地 `.env` 填入真实身份（全为公开标识，不含签名私钥）：

```dotenv
LINJI_APP_ENV=preview
LINJI_ANDROID_PACKAGE=com.yourcompany.linji.preview
LINJI_IOS_BUNDLE_IDENTIFIER=com.yourcompany.linji.preview
LINJI_EAS_PROJECT_ID=YOUR_REAL_PROJECT_UUID
LINJI_EXPO_OWNER=YOUR_EXPO_ACCOUNT_OR_ORGANIZATION
EXPO_PUBLIC_API_BASE_URL=https://REPLACE_DOMAIN/snow-api/api/v1
```

这是一套新应用身份示例；更新原应用必须沿用原 package 与签名。UUID 必须是实际项目 ID，不能填测试夹具值。由于 `.easignore` 排除了 `.env*`，仅写本地 `.env` **不会让云端得到这些变量**。

到 Expo dashboard 对应项目的 Environment variables 页面，为 **preview** 和按需的 **production** 环境配置下面五个变量，使用可在配置解析阶段读取的明文可见性：`LINJI_ANDROID_PACKAGE`、`LINJI_IOS_BUNDLE_IDENTIFIER`、`LINJI_EAS_PROJECT_ID`、`LINJI_EXPO_OWNER`、`EXPO_PUBLIC_API_BASE_URL`。LINJI_APP_ENV 已由 eas.json 各 profile 设置。CLI 操作可用 `npx eas-cli@27.10.0 env:create --help` / `env:list` 查当前版本参数；不要把模型秘密当环境身份变量上传。

本地预检查要让身份变量进入进程环境，**release:check 本身不加载 .env**。PowerShell：

```powershell
$env:LINJI_APP_ENV='preview'
$env:LINJI_ANDROID_PACKAGE='com.yourcompany.linji.preview'
$env:LINJI_IOS_BUNDLE_IDENTIFIER='com.yourcompany.linji.preview'
$env:LINJI_EAS_PROJECT_ID='YOUR_REAL_PROJECT_UUID'
$env:LINJI_EXPO_OWNER='YOUR_EXPO_ACCOUNT_OR_ORGANIZATION'
$env:EXPO_PUBLIC_API_BASE_URL='https://REPLACE_DOMAIN/snow-api/api/v1'
pnpm release:check
npx --yes eas-cli@27.10.0 build --profile preview --platform android
```

Bash 将上述赋值写为 `export KEY='value'`，再运行同样两条命令。EAS 按提示选择生成或使用自己的 Android keystore；更新旧应用必须导入原签名，不能重新生成。保存签名和密码到私有安全备份。构建详情页下载 APK 后，在本仓创建 `outputs/apk/` 并保存文件与 SHA-256；这是下载后的本地交付目录，不会推送到 Git。

Android production 命令为 `npx --yes eas-cli@27.10.0 build --profile production --platform android`，输出 AAB 用于商店；不能像 APK 一样直接点击安装。iOS 需要 Apple 签名/设备或商店渠道，按 [EAS 官方教程](https://docs.expo.dev/build/setup/)准备，不宣称 Windows 可以本地编译 iOS。当前没有自动商店提交或 OTA 发布配置。

### 9.3 可选：本地 Android 调试环境

只用 EAS 可跳过本节。Windows 安装 Temurin JDK 21、Android Studio，SDK Manager 勾选 SDK Platform 37、Build Tools 37.0.0、Platform Tools、Android Emulator、NDK 27.1.12297006、CMake 3.22.1；Device Manager 新建 Android 15/API 35 的手机模拟器。Windows on x64 使用 x86_64 模拟器，实体手机按自己的 ABI；交付过的 1.0.4 APK 为 arm64。

设置 `JAVA_HOME` 指向 JDK 根目录、`ANDROID_HOME` 指向 SDK 根目录，并把 `%JAVA_HOME%\bin`、`%ANDROID_HOME%\platform-tools`、`%ANDROID_HOME%\emulator` 加入用户 PATH，重开终端验证 `java -version` 与 `adb devices -l`。安装 SDK/licenses 可用 SDK Manager，或 SDK 的 `cmdline-tools/latest/bin/sdkmanager`（需先安装 Command-line Tools）：

```powershell
& "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat" "platform-tools" "platforms;android-37" "build-tools;37.0.0" "ndk;27.1.12297006" "cmake;3.22.1"
& "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat" --licenses
```

同意前阅读许可证。在 App 仓库设置 development 模式与自用 Android 包名、可达 API，然后：

```powershell
$env:LINJI_APP_ENV='development'
$env:LINJI_ANDROID_PACKAGE='com.yourcompany.linji.dev'
$env:EXPO_PUBLIC_API_BASE_URL='https://REPLACE_DOMAIN/snow-api/api/v1'
pnpm exec expo run:android --device
```

该命令生成原生工程、构建并安装**调试包**，通常需 Metro；不是正式签名交付包。生成的 android/ios 不提交，修改原生行为通过 app.config.ts/plugins。不要把 `assembleRelease` 默认调试签名输出当生产包。Windows 深路径原生编译可能需要短路径/专属缓存，正式安装包优先采用上面的 EAS 路径；作者机器上的 `runtime/builds/app/build-apk.ps1` 不在这三个仓库内，**不是新电脑必须具备的脚本**。

Android 模拟器访问宿主一般使用 `http://10.0.2.2:8080/api/v1`，但 Android cleartext 策略可能拒绝 HTTP；因此安装包默认使用已部署 HTTPS API。实体手机 localhost 是手机自身。USB 调试可 `adb reverse tcp:8080 tcp:8080` 映射端口，但仍须满足应用网络策略，不能用它绕过发布版的 HTTPS 校验。

### 9.4 安装与实机验收

手机允许安装来自当前文件管理器的应用，或连接已授权 USB 调试后执行：

```bash
adb devices -l
adb install -r outputs/apk/YOUR_DOWNLOADED_APK.apk
```

将文件名替换为自己的真实文件；出现 unauthorized 要在手机允许本机调试。验证冷启动、四导航入口、圆角/字号/深色、登录恢复/退出/切号、上传授权、知识详情、AI 流式/历史、断网/恢复/后台切换。模拟器检查和真实手机检查分别记录。签名不一致不能覆盖安装；不要为安装方便直接卸载有重要本地数据的旧包。

## 10. 质量检查与学习进阶

每仓运行自己的 `pnpm check`，Web 另运行 `pnpm build:web`、`pnpm build:admin`；Backend 运行 `pnpm build`、`pnpm test:e2e`；App 运行 `pnpm exec expo export --platform all`。App 的 bundle export 不是 APK。需要真实数据库/存储/模型的专项另用隔离资源运行，不把线上库用于集成测试。

学习阶段与练习见本仓 [learning-roadmap.md](learning-roadmap.md)。后端契约是唯一来源：改 Backend DTO/实现后导出 OpenAPI → 客户端同步快照和 lock 中的原始字节 SHA → 生成类型 → 三仓检查 → 先发布兼容 API，再发布客户端。三仓当前契约 1.55.0，实际内容以 contracts 为准。

GitHub Actions 负责 CI，不自动部署生产或替你生成签名。SDK/JDK、node_modules、真实 `.env`、模型、数据库备份、keystore 和 APK 不进入源码提交。每次发布记录提交号、依赖/镜像 digest、环境档位、签名公开指纹、产物 SHA 与验收范围。

## 11. 常见问题：按现象定位

| 现象                         | 优先检查与处理                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| node/pnpm/docker 找不到      | 重开终端，检查 PATH、Node 版本、Docker 引擎是否启动                                            |
| pnpm 自动重装旧 node_modules | 从另一系统/磁盘复制的依赖不能复用；在独立新 clone 中冻结安装，不删除其他项目目录               |
| pnpm 版本不对                | 先看本仓 packageManager；Web 11.19.0，其他 11.25.0；可用 npx 明确版本执行                      |
| lockfile 或供给链策略拒绝    | 保留锁文件并检查完整错误、网络与仓库 pnpm-workspace 政策；不使用 --no-frozen-lockfile 掩盖问题 |
| Docker pull/build 失败       | 检查代理/DNS/TLS、镜像 digest、Go 模块源；MinIO 需源码构建                                     |
| Prisma P1001 / vector 缺失   | 检查容器、端口、URL、健康状态与 pgvector 镜像；先迁移再启动                                    |
| DB verify 读不到 URL         | 按教程使用 `pnpm exec tsx --env-file=.env scripts/verify-database.ts`，确认当前目录            |
| 新站列表为空                 | seed 只有权限角色/初始管理员；用管理端创建并公开内容                                           |
| 登录后立刻掉线               | 检查 Secure Cookie、Origin、host一致性，线上检查 proxy_cookie_path 与 HTTPS                    |
| 管理端按钮跳 Nginx 默认页    | 核对构建 basePath=/snow-admin 与反代保留路径；改公开变量后重构建                               |
| 图片签名失败 / 403           | S3_PUBLIC_ENDPOINT、代理 Host/路径、桶私有权限、时钟及扫描状态                                 |
| 上传扫描超时                 | ClamAV 病毒库和 clamd 就绪、端口及总扫描超时，不关闭扫描绕过                                   |
| AI timeout / 无引用          | 先独立验证 Chat/Embedding，再查1024维、公开来源、Outbox/topic/consumer、索引与 SSE             |
| 手机连接不上 API             | 手机 localhost 不是电脑；用可达 HTTPS，检查 Wi-Fi/防火墙、证书、原生网络策略                   |
| EAS 找不到身份/Key           | 核对本地进程变量及所选 EAS environment；.env 不上传；应用身份与模型 Key 不同                   |
| App 源码更新但旧 APK 没变    | 源码 push 不等于发布；重新构建签名、递增版本并安装                                             |
| 更新后需要回滚               | 先查数据库兼容计划，再切旧 release；不得在生产执行 migrate reset/drop/down -v                  |

## 12. 参考文档与验收边界

官方下载以第 1 节为入口；项目细节继续阅读本仓 [development.md](development.md)、[deployment.md](deployment.md)、[repository-security.md](repository-security.md)。三个 README 与本手册是当前入门入口，历史 engineering/validation 文档只说明相应日期的环境和结果。

本文更改的是教程，不会替读者申请域名、购买模型额度、生成私钥、部署服务器或证明全新主机的业务已经通过。按每阶段的成功标志实测并保留记录，才能确认自己的运行环境可用。
