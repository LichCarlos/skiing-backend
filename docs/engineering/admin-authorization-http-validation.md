# 管理端授权真实HTTP验收

2026-11-03 系统配置完整读取与恢复续验：真实管理HTTP77项（新增配置2项）及后置核对通过：默认六项、名称0→1→2、旧版本409、实际提交响应丢失后的人工读取核对且无重写、政策字面文本保存、匿名七字段投影/revision变化、复制grants非管理员拒绝、读取期真实退出与显式登录恢复均验。最终两条配置/版本2与1、三条仅版本元数据的成功审计精确匹配，总Outbox53保持；原业务断言保持，临时服务已停止。见[当前配置核对](admin-config-http-validation.md)。下方测试数为历史记录。

2026-11-03 字典回执与生命周期续验：真实管理HTTP75项（新增字典2项）及后置核对通过：配置grants的普通角色完成类型/父子项建档、编辑、循环400拒绝、子项及类型停用，分组/状态/后续空页与读取期实际角色撤权均验。八条成功审计、十条pending字典事件（父4/子6）与最终层级/状态/字段精确匹配，总Outbox53；原业务断言保持，临时服务已停止。见[当前字典核对](dictionary-workflow-http.md)。下方测试数为历史记录。

2026-11-03 项目知识完整读取与生命周期续验：当前管理真实HTTP73项及后置核对通过，新增项目知识完整读取、真实退出会话时拒绝旧响应与显式恢复，见[当前范围](project-knowledge-read-http-validation.md)。下方测试数为历史记录。

2026-11-03 媒体管理完整读取与生命周期续验：当前管理真实HTTP71项与后置持久核对通过，新增媒体范围/引用保护/软删除及读取期撤权，见[当前范围](asset-admin-http-validation.md)。下方测试数为历史记录。

2026-11-03 社区审核完整读取与生命周期续验：当前管理真实HTTP67项及后置核对通过，新增社区发布/复审/隐藏恢复、评论审核与软删、实际读取期间撤权，见[本轮范围](community-moderation-http-validation.md)。下方测试数为历史记录。

2026-11-03 全局雪场完整读取与管理续验：当前管理真实HTTP63项与后置核对通过，新增全局雪场可配置权限/改归属/发布下架/撤权和软删流程，见[本轮范围](global-resort-http-validation.md)。下方测试数为历史记录。

2026-11-03 商家雪场完整读取与复审续验：当前管理真实HTTP59项及后置核对通过，新增雪场完整生命周期、商家隔离及读取期撤权，见[本轮范围](merchant-resort-lifecycle-http-validation.md)，下方数量为历史记录。

2026-11-03 文章完整响应与生命周期续验：当前55项管理真实HTTP及后置持久核对通过，新增文章生命周期、self/selected与读取期撤权；见[本轮范围](article-lifecycle-http-validation.md)，下方数量为历史记录。

2026-11-03 动态字段完整响应续验：当前管理HTTP51项与后置持久核对通过，新增字段字典关联、版本/分组保护与撤权场景；见[本轮范围](custom-field-http-validation.md)，下方数量为历史记录。

2026-11-03 工作台汇总读取与联调：当前管理HTTP31项及后置持久核对通过，夹具增加两条专用合成商家收益并确认查询未改变它们；首轮遗漏既有本人资料读取grant已修正，失败环境已停止。结果见[本仓证据](../validation/dashboard-lifecycle-20261103.json)，现有知识/RAG/事件和隔离断言保留；以下为历史阶段。

2026-11-03 项目知识与事件运维联调：当前Web27项及后置知识/事件持久核对通过；最终目录D:/linji-content-http/20261103/final/linji-admin-http-owyISh，见[新增断言与范围](content-events-http-validation.md)及[证据](../validation/content-events-http-20261103.json)。以下保留历史阶段。

2026-11-03 RAG来源真实HTTP续验：夹具新增三个RAG来源及两个真实vector(1024)分块；Web现行21项、前后结构与后置持久核对通过，最终目录 D:/linji-rag-http/20261103/verified/linji-admin-http-MFQwEY。详见[来源持久验证](rag-source-http-validation.md)和[本轮证据](../validation/rag-source-http-20261103.json)。以下为历史阶段。

2026-11-03 AI审计增量：专用夹具新增本人正常/软删除、他人和游客会话，以及两条大ID消息/历史引用数组。Web现行十五项和后置持久断言通过，最终目录 D:/linji-audit-lifecycle/20261103/runs/linji-admin-http-kExJVJ；24迁移、双seed、前后结构校验及唯一正文访问审计/原消息完整性核对完成，本次Node/PostgreSQL已停止。首轮旧CSRF缓存测试断言失败的环境也已停止，失败日志保留；生产鉴权和客户端没有放宽。见[本轮证据](../validation/ai-audit-lifecycle-20261103.json)。本轮不重计完整839项数据库套件，也不代表浏览器/模型验收。以下为此前阶段。

2026-11-03 操作日志增量：Web现行十二项、后置持久核对及前后结构复验通过，新增只读日志生产读取器联调；范围见[本轮证据](../validation/operation-log-lifecycle-20261103.json)。目录 D:/linji-operation-logs/20261103/runs/linji-admin-http-mBbvld 执行24迁移和双seed；65113/58757无监听，PID及初始化密码文件不存在，本次Node/PostgreSQL均已停止。当前OpenAPI1.51.0/143操作，没有新增业务API/迁移。以下为此前阶段。

2026-11-03 字典增量：现行客户端十一项在新临时库通过，新增读取字典列表/详情及父子树（含停用子项）。夹具直接准备两条合成项目，后置核对其父子关系和状态；不增加生产接口。目录 D:/linji-dictionary-recovery/20261103/runs/linji-admin-http-SSlHo1 完成23迁移、双seed、前后verify及持久核对，62494/64737无监听、PID/初始化密码文件缺失；[本轮摘要](../validation/dictionary-recovery-http-20261103.json)绑定日志/源码。以下为此前阶段。

末次源码复验目录：D:/linji-field-recovery/20261103/final/linji-admin-http-6FlrOE。客户端十项、后置持久核对和结构复验通过，Node/PostgreSQL均停止；60637/50432无监听且PID/初始化密码文件缺失，结果绑定本轮 field-recovery-http 摘要。

2026-11-03 字段恢复增量：同一入口在新临时库配合 Web 现行十项套件通过；新增字段/分组生产读取器一项，Backend运行时及夹具保持。后置持久核对、结构校验和本次服务停止通过，目录 D:/linji-field-recovery/20261103/runs/linji-admin-http-NdRLcx；见[本轮摘要](../validation/field-recovery-http-20261103.json)。以下为上轮九项的历史证据。

负责人：Backend。状态：入口、九项联调与后置验证通过；浏览器及生产环境待验。基线：OpenAPI1.50.2/143操作。

2026-11-03 实测九项客户端联调及后置持久核对通过，最终目录 `D:/linji-admin-http/20261103/runs/linji-admin-http-KS39Eg`，本次Node/PostgreSQL已停止；[本仓摘要](../validation/admin-authorization-http-20261103.json)保存运行结果、源码与日志摘要。首轮测试角色漏授account:profile:read导致会话复核403，已保留失败并停止；仅修正夹具授权，在新临时库重验，没有放宽生产鉴权。

本仓 `pnpm test:native-admin-http` 启动编译后的 Nest 服务和独立 Windows PostgreSQL 17/pgvector，等待另一个独立 Web 仓库执行客户端套件，然后核对持久化与停止状态。复用本仓 `scripts/native-http-runtime.ts` 的临时集群生命周期；原 `test:native-public-http` 保留独立入口、数据库名和夹具。这里不启动 Next、Expo 或 Docker。

先按 [原生数据库说明](native-postgres-validation.md)准备 PostgreSQL，在本仓完成冻结安装、check、HTTP/框架测试与build：

```powershell
$env:NODE_OPTIONS='--max-old-space-size=1536'
$env:VITEST_MAX_WORKERS='1'
$env:LINJI_NATIVE_PG_ROOT='D:/linji-native-postgres/20261103/runtime/pgsql'
$env:LINJI_NATIVE_PG_OUTPUT='D:/linji-admin-http/20261103/runs'
$env:ADMIN_AUTH_HTTP_PASSWORD='<仅本次合成账号密码，8至72字节>'
pnpm test:native-admin-http
```

入口要求显式运行时/输出路径，mkdtemp 创建新集群，随机生成SCRAM数据库密码和JWT密钥；指定库名 `linji_admin_authorization_validation`，PostgreSQL只监听自动选择的回环端口。HTTP使用生产main默认监听方式，测试地址为回环。24迁移、双seed、前置db:verify后准备两个无角色假设的商家业务资料、两家草稿雪场及公开性默认false的备注/私有字段。合成管理员账号为admin_http_root，密码与Web测试通过终端环境约定，不写入ready.json或fixture.json。真实业务没有绕过商家建档API：这是专用临时库测试夹具，不能用来声称D-49已实现。

输出ready.json仅含API地址和非凭证夹具。Web按其本仓工程文档运行，除HTTP地址、夹具及合成密码外不取得数据库或JWT/存储密钥。测试通过后写client-result.json，再将同目录stop.request写为passed。客户端失败时可写failed，使服务端报告失败并立即进入停止流程；不能将失败伪装成passed。未收到确认最多等待15分钟，不重启或重放测试。

后置夹具验证两家雪场的介绍/私有字段、账号最终角色、撤销的字段策略、拒绝请求没有成功审计、唯一合法雪场写入及单条Outbox、全部会话退出和受保护管理员仍有效，然后执行末次db:verify。finally只停止本次Node与数据目录，删除初始化密码文件，保留合成数据和脱敏日志；不操作其他数据库/项目。通过必须同时满足命令退出0、report.completed/stopped/serverStopped均true及端口/PID核对。

这条链路检验Web生产模型、真实HTTP、Nest授权与PostgreSQL持久化。Node仅模拟Cookie保存、路径发送和Origin，不能证明浏览器Secure/SameSite/CORS、实际React/Next页面、RSC或设备行为。Kafka/存储/供应商不参与本套件，Outbox只验证事务持久化，不计投递成功。完整830项数据库套件不因此重复计数。
