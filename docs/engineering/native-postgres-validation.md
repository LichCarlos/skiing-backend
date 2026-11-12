# Windows 隔离 PostgreSQL 验收

2026-11-04 全业务数据库续验：当前源码36文件859项完整数据库测试、24迁移/双seed/前后校验通过，专用集群已停止；新结果见[回归说明](full-database-regression.md)，下文旧日期/计数保留当时事实。

日期：2026-11-03。用途：Docker 不可用时，用真实 PostgreSQL 17 / pgvector 执行现有迁移和数据库测试。不更改 API、数据库模型或生产部署方式，不替代 Kafka、对象存储、ClamAV 或容器发布验收。

## 二进制与扩展来源

PostgreSQL 来源为 [EDB 官方便携二进制页面](https://www.enterprisedb.com/download-postgresql-binaries)，其中 PostgreSQL 17.11 的 Windows x86-64 链接经 EDB 跳转至 [17.11-5 压缩包](https://get.enterprisedb.com/postgresql/postgresql-17.11-5-windows-x64-binaries.zip)。2026-11-03 下载大小为 381531864 字节，本机记录 SHA-256 为 `80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f`。该值是本次下载内容的本地指纹，不声称是另行获取的官方签名或校验清单。

仅解压 `pgsql/bin`、`lib`、`share`、`include` 到独立 D 盘目录，保留原压缩包及其许可证材料；未运行安装器、注册服务或修改系统 PATH。`postgres --version` 实测为 PostgreSQL 17.11。

pgvector 使用[官方仓库 v0.8.1](https://github.com/pgvector/pgvector/tree/v0.8.1)，提交 `778dacf20c07caf904557a88705142631818d8cb`。按该版本 README 的 Windows 构建说明，在本机已有 Visual Studio 2022 BuildTools x64 环境设置 PGROOT，执行 `nmake /F Makefile.win` 和 `nmake /F Makefile.win install`；安装目标仅为上述便携目录。MSVC 工具集为 14.44.35228.0；本次 vector.dll 的本地 SHA-256 为 `ef359cc564ec708737daea217922948306718cc641f2f2cddd5e99502d59acc5`，编译器或设置变化可能改变此指纹。

下载、扩展源码、构建日志和运行记录保留在 `D:/linji-native-postgres/20261103/`，不加入 Git。没有运行 pgvector Makefile 的 clean/uninstall，也未操作其他项目服务。

## 后端仓库内执行

准备含 pgvector 的 PostgreSQL 17 后，在本仓根目录运行：

```powershell
pnpm install --frozen-lockfile
$env:NODE_OPTIONS='--max-old-space-size=1536'
$env:LINJI_NATIVE_PG_ROOT='D:/linji-native-postgres/20261103/runtime/pgsql'
$env:LINJI_NATIVE_PG_OUTPUT='D:/linji-native-postgres/20261103/runs'
pnpm test:native-db
```

[验收脚本](../../scripts/validate-native-postgres.ts)只在 Windows 执行，要求上述两个显式路径；每次用 mkdtemp 创建新的数据目录，忽略外部 DATABASE_URL，不接受现成集群。随机生成临时数据库与初始管理员密码，以 SCRAM 认证，只监听 127.0.0.1 的自动分配端口；端口探测后若被占用则启动失败，不停止其他监听者。限制连接数、缓冲区和测试 worker，不安装系统服务。

脚本依次初始化、启动、建空库、执行本仓 Prisma migrate deploy、两次 seed、db:verify、完整现有 vitest.config.database.ts、末次 db:verify。库名使用现有密码重置套件要求的 linji_password_validation，集群目录、端口与密码独立生成；不关闭、放宽或伪装该安全门禁。CLI 使用本仓依赖和当前 Node，不连接前端目录或其他仓库。生成脱敏步骤日志及 report.json，其中记录版本、端口、迁移数、每步结果和停止状态，不写密码或完整连接串。初始密码文件使用后删除；只保留隔离测试库与诊断资料，不递归删除目录。

普通成功/失败路径均在 finally 中断开 Prisma，并针对本次数据目录执行 pg_ctl stop。Windows 启动使用无管道的子进程并等待 pg_ctl 退出，服务诊断单独写入 server.log，避免 PostgreSQL 继承输出管道导致启动步骤一直等待。首轮发现该问题后，只停止了首轮自己的临时库；失败记录保留，重跑使用新目录。

通过标准为命令退出 0、report.completed 和 report.stopped 均为 true、数据库套件全部通过、末次结构校验通过。不能仅凭服务能启动或部分用例成功判定完成。若宿主或脚本被强制终止，finally 不保证执行：应查看该次 report.json/postmaster.pid，并仅对该次完整数据路径执行 `pg_ctl stop -D <该次数据目录> -m fast -w`，不能使用全局结束 postgres 的命令。

## 本轮结果与边界

最终运行目录为 D:/linji-native-postgres/20261103/runs/linji-native-fEFduL，回环端口62146；23项迁移、双seed、前后结构校验及完整34文件830项数据库测试均通过，命令退出0。结构检查覆盖pgvector/HNSW、15个唯一性/向量索引、18个约束、RAG控制列、3个内置角色和初始管理员/收益/AI权限边界。report.completed和report.stopped均为true，停止日志及postmaster.pid缺失已核对，初始密码文件已移除。脱敏版本/步骤/测试计数、日志摘要和下载来源见本仓[验收摘要](../validation/native-postgres-20261103.json)。

保留两次失败：linji-native-VUWCED的启动管道等待问题在手工停止该临时库后结束；linji-native-UEAmN6完成817项，但密码重置13项被专用库名保护拒绝执行，因此整体失败，不能计作完整通过。改用既有保护要求的库名后，以新集群重新执行全部830项，未修改或跳过测试，也没有设置虚假的CI标记。

测试连接真实 Windows PostgreSQL 和本地编译的 pgvector，涉及事务、SQL、约束、HNSW 及应用 HTTP 的用例据其源码范围解读。外部 Chat/Embedding、Kafka、对象存储等测试替身不因此变为真实供应商验收。Windows 不证明 Linux 容器、镜像、非 root/只读文件系统、OS 信号排空或容器重启行为；原容器验收继续待办。没有启动 Docker，也未重试此前被自动审批拒绝的前端服务启动。
