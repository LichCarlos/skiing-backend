# 独立源码导出与冷安装

2026-11-03 已在 `D:/linji-source-export/20261103/run-01/backend` 完成675文件快照的全新store冻结安装、Prisma生成、完整check（1192单测及8项导出测试）、158项HTTP/框架测试、build与编译后OpenAPI导出。首次普通generate中断后，显式选择副本自身已核验引擎完成，详见下文；既有原生数据库脚本lint警告保留。[本仓验证摘要](../validation/source-export-20261103.json)绑定源码清单、模块实际路径、引擎版本及日志摘要。未重复运行数据库套件或启动HTTP服务。

本仓提供 `pnpm source:export <新建绝对目录>`，只导出 Backend 当前工作树，不启动其他项目、不读取兄弟仓库，也不需要部署环境。脚本只依赖 Node 22 与 Git；目标的父目录须已存在，目标本身须不存在。

```powershell
pnpm test:source-export
pnpm source:export D:/linji-source-validation/backend
```

导出器读取本仓 Git 跟踪及未忽略的未跟踪文件，保留未提交修改及新增源码，排除已删除文件。因此它是当前工作树快照，不是 Git 提交或远程发布。排除 .git、依赖树、构建/测试输出、日志、环境凭证及本机 Agent 配置；保留 .env.example 等环境模板。禁止源文件链接，且解析 Windows 长路径及目标父目录 junction，拒绝覆盖、嵌套或通过链接写回源码目录。失败时不递归删除，可能保留部分副本供诊断；重试使用新的目标。

本仓 test/fixtures/kafka-tls 下的三个既有合成 PEM 是明确允许的测试夹具；它们用于独立 TLS 测试，不是部署凭证。其他私钥/证书容器文件名会被拒绝。文件筛选不等于内容密钥扫描，导出结果也不包含 Git 历史或线上配置。

输出 .source-export.json 记录各文件路径、字节数和 SHA-256、包管理器及 OpenAPI 摘要。sourceSha256 为按路径排序后的 `sha256<TAB>bytes<TAB>path<LF>` 串的 SHA-256。复制时核对目标字节，结束时重读源码与文件集合；检测到变动则失败。这是可核对的本地导出，不宣称并发修改下的原子文件系统快照。

在副本自身目录独立执行，首次 store 使用全新路径：

```powershell
Remove-Item Env:NODE_PATH -ErrorAction SilentlyContinue
$env:NODE_OPTIONS='--max-old-space-size=1536'
$env:VITEST_MAX_WORKERS='1'
pnpm install --frozen-lockfile --store-dir D:/linji-source-validation/stores/backend
pnpm db:generate
pnpm check
pnpm test:e2e
pnpm build
node dist/openapi-export.js
```

check 包含既有 lint/类型/单测与新增八项 CLI 黑盒测试，验证字节/摘要、未提交文件及删除、过滤、拒绝覆盖/越界、junction 与凭证拒绝。夹具通过 Git init 创建；清理前校验只操作本次临时测试目录。

Windows 首次 Prisma generate 可能继续访问外部引擎服务。本轮该进程停留于 HTTPS 请求，核对进程身份后仅结束本次生成；未将中断记为通过。副本安装包内已有两个引擎，已核对 query/schema commit 均为锁定的 `2ba551f319ab1df4bc874a89965d8b3641056773` 并记录本地 SHA-256，随后显式选择本副本引擎完成生成，不复制原仓库或全局缓存的二进制。遇到同样情况时，先独立核验版本，再在该副本终端设置：

```powershell
$engineRoot=Join-Path (Get-Location) 'node_modules/.pnpm/@prisma+engines@6.19.0/node_modules/@prisma/engines'
$env:PRISMA_QUERY_ENGINE_LIBRARY=Join-Path $engineRoot 'query_engine-windows.dll.node'
$env:PRISMA_SCHEMA_ENGINE_BINARY=Join-Path $engineRoot 'schema-engine-windows.exe'
$env:CHECKPOINT_DISABLE='1'
pnpm db:generate
```

这是本次 Windows 验收的显式环境选择，不修改 schema 或通用 db:generate 命令；Linux/容器使用各自安装平台的引擎。版本和路径不能照搬到不同 Prisma 版本，不能仅凭文件存在就视为已核验。

源码副本没有 .env、数据库或运行凭证。上述编译/框架测试及 OpenAPI 导出不等于数据库迁移、容器或真实供应商验收。真实数据库另按 [Windows PostgreSQL 验收](native-postgres-validation.md) 运行；容器待办遵循 [发布工程说明](container-release.md)。每次记录副本目录、工具版本、独立模块 realpath、安装/检查/构建退出码与清单摘要，不把旧版本的冷安装证据当作当前版本结论。

## 接收源码前的独立完整性校验

2026-11-04新增 `pnpm source:verify <源码副本绝对路径> <外部可信SHA-256>`。校验器只使用Node内置模块，不需要Git、依赖、原目录或其他仓库；三个仓库各自维护入口。请先校验完整、尚未安装依赖或写入.env的源码副本，之后再冻结安装。

```powershell
# 在可信的本仓目录执行；摘要从交付方的独立可信渠道取得。
pnpm source:verify D:/delivery/backend <sourceSha256>

# 已信任此校验器代码时，可直接用Node运行，无需pnpm安装依赖。
node --experimental-strip-types scripts/export-source.ts --verify D:/delivery/backend <sourceSha256>
```

它核对formatVersion、必需文件、严格排序且唯一的相对路径、文件大小/摘要、源清单总摘要、packageName/packageManager及OpenAPI元数据，拒绝链接、越界路径、缺失、增加或修改的文件。校验不执行被校验目录中的产品代码，也不写入或删除文件。所有文件都须列入清单；安装后生成的node_modules、构建产物或.env会导致文件集合检查失败，不能用该命令校验已配置的运行目录。

摘要必须另行保存，不能从收到的待校验清单自动取值；重新计算被篡改清单不能通过原外部摘要。自带脚本不是信任根：收到不可信交付时应先用已信任的本仓校验器，不能先执行对方脚本。该方式校验已知摘要下的完整性，不提供数字签名、发布者认证、内容密钥扫描、原子文件系统快照或实际启动证明。导出快照不含Git历史，交付后是否初始化新Git仓库由接收方决定。

新增12项CLI回归与既有8项导出回归一起纳入 `pnpm test:source-export`/`pnpm check`。CI在本地完成导出、外部记录的摘要核对与tar归档后，配置上传源码及独立摘要元数据；尚未运行远程CI，配置不是已发布证据。

## 2026-11-04 实际源码包与冷安装复验

源码工具现为20项CLI黑盒回归，其中新增12项独立校验；只依赖Node/Git的导出和只依赖Node的校验均通过，包管理器脚本可选使用pnpm。实际源码归档为 `D:/linji-source-verify/20261104/backend-source.tar.gz`，独立摘要元数据为同目录 `backend-source-metadata.json`。

本仓冻结点：794文件，sourceSha256=`fd89d83c7023cff301d50eb4917ecfc9e4585c111a0854245160f81e4071fd74`，tar.gz SHA-256=`d8327fc596e534d83153f0b98cc492338a22aeb89185496306de313f914d912c`。压缩包先验证、解包后再验证，在 `D:/linji-source-verify/20261104/cold/backend` 使用首次不存在的独立store冻结安装。模块实际路径与源文件摘要均有记录；未借用父目录或其他仓库代码。归档是本轮代码及预先说明文档的冻结快照，最终README/结果报告在校验后增加，不会回写已封存压缩包。

冷副本完整验证：Backend1271单测+20源码工具、173HTTP框架、build/编译后OpenAPI；Web3045业务+20源码工具+20发布工具、官网/Admin双强制构建（0缓存）及独立包校验；App1217业务+20源码工具+10产物工具、Doctor20/20、三平台导出/导出后类型及88文件封存迁移校验，均通过。外部验收编排首次在Web成功冷安装后从workspace根误定位Next，实际应从apps/web解析；修正后只从模块核对续跑，未重复已通过命令，原记录保留。Web下载警告随日志保留；App首次新store冻结安装因依赖下载超时以1退出，随后在同一专用部分store降低并发为4、下载超时延长至180秒仍反复超时/连接重置，经核对进程身份后中止本次安装；最后以npmmirror、并发2及原锁完整性校验续装通过。未更改锁文件/源码或借用其他依赖；首轮失败、中止及恢复日志均保留，不将前两次安装记为通过。详见[本仓冷验报告](../validation/source-verify-20261104.json)。源码压缩包是验收冻结点的不可变快照，最终结果README/报告在其后归档；已逐文件核对冻结内容与原仓/冷副本匹配，产品源码、依赖和契约一致。三仓OpenAPI1.51.1/143操作和24迁移保持；本轮未修改业务API/数据库，未重跑上一轮845数据库测试。只验证独立安装/构建/导出，不计生产监听、浏览器/设备、真实模型/存储、Kafka/容器或远程CI；CI源码归档/上传仅本地配置。Windows Kafka AccessDenied未解决，35秒用例未运行；D-49/D-50/D-09待决，父目录遗留依赖清理与先前服务启动拒绝未重试，Docker未启动/重启/借用WSL，整体目标未完成。
