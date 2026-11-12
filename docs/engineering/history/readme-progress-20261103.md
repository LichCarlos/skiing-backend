# README阶段记录归档（2026-11-03）

以下为本次整理前的原README开头，保留原阶段版本、测试和限制；当前状态以[README](../../../README.md)及对应验证报告为准，历史绿灯不能替代当前源码验收。

2026-11-03 媒体管理完整读取与生命周期续验：真实管理HTTP71项（新增媒体4项）及后置持久核对通过：配置角色self/all/selected、外部404/merchant403、后续空页、900秒离线签名、头像引用停用422和解除、媒体软删除保留库存与实际读取期间撤权均验。三资产归属/大小/私有键及ready/deleted/ready最终状态、唯一停用审计与两条资料审计精确匹配，最终头像null，总Outbox43。临时服务已停止。本仓1240单测+8工具、173HTTP框架与build通过，生产业务/迁移保持。见[工程说明](../../../docs/engineering/asset-admin-http-validation.md)与[本仓证据](../../../docs/validation/asset-admin-reads-20261103.json)。契约1.51.1/143操作与24迁移保持。D-41的selectedIds仍为安全整数数组，selected实测101，大整数字符串仅all/self；签名与软删不证明真实S3/上传/下载/扫描/物理对象删除。模拟Hooks/EventTarget及Node Cookie不计真实浏览器/React/BFCache/设备验收，身份前后复核非原子快照，停用命令无客户端版本条件/幂等键。Kafka/模型/Embedding/存储、容器/签名包及远程CI仍待验。D-49/D-50/D-09未实施，项目未完成，Docker未启动/重启。

2026-11-03 社区审核完整读取与生命周期续验：真实管理HTTP67项（新增社区4项）和数据库后置核对通过：配置角色创建/批准、已发布编辑重新审核、隐藏恢复、评论隐藏恢复/重复恢复409/软删除、实际读取期间撤权及动态软删除均验。一条动态和一条评论软删及最终资料、七事件/八审计逐条匹配，总Outbox43；临时服务已停止。本仓1240单测+8工具、173HTTP框架和build通过，生产业务及迁移保持。见[工程说明](../../../docs/engineering/community-moderation-http-validation.md)与[本仓证据](../../../docs/validation/community-reads-20261103.json)。OpenAPI1.51.1/143操作与24迁移保持。模拟Hooks/EventTarget及Node Cookie不计真实浏览器/React/BFCache/设备验收；身份前后检查不提供跨请求原子快照，既有审核命令无客户端版本前置条件/幂等键。社区数据范围未定版，本轮不新增。真实Kafka/模型/Embedding/存储、容器/签名包和远程CI仍待验。D-49/D-50/D-09未实施，整个项目未完成；Docker未启动或重启。

2026-11-03 全局雪场完整读取与管理续验：真实管理HTTP63项（新增全局雪场4项）与后置持久核对通过：可配置普通角色建档/发布、字段过滤和私有字段拒绝、管理员修改评分/改归属、下架/再发布、原商家404、错误范围403、实际读取期间撤权及软删除均验。新全局行软删/归属/评分/资料、六事件/六审计精确匹配；原数据断言保持，雪场事件15、总Outbox36。临时服务已停止。本仓1240单测+8工具、173HTTP框架和build通过，生产业务及迁移保持。见[工程说明](../../../docs/engineering/global-resort-http-validation.md)与[本仓证据](../../../docs/validation/global-resort-reads-20261103.json)。OpenAPI1.51.1/143操作与24迁移保持。模拟Hooks/EventTarget及Node Cookie不计真实浏览器/React/BFCache/设备验收；身份前后检查不提供跨请求原子快照，既有雪场DTO没有客户端版本前置条件/创建幂等键。真实Kafka/模型/Embedding/存储、容器/签名包和远程CI仍待验。D-49/D-50/D-09未实施，整个项目未完成；Docker未启动或重启。

2026-11-03 商家雪场完整读取与复审续验：真实管理HTTP59项（新增雪场4项）与后置持久核对通过：建档→送审→发布→编辑复审/公开隐藏→再发布→下架→重新送审→软删除，外商家404及实际读取期撤权均验；新雪场归属/资料/DeletedAt、八事件/八成功审计、原雪场1事件/另一商家0事件与总Outbox30条核对，两轮临时服务均已停止。本轮只扩展联调夹具，生产业务保持；本仓1240单测+8工具、173HTTP框架与build通过。见[工程说明](../../../docs/engineering/merchant-resort-lifecycle-http-validation.md)与[本仓证据](../../../docs/validation/resort-reads-20261103.json)。OpenAPI1.51.1/143操作、24迁移保持。Node Cookie与模拟Hooks/EventTarget不计真实浏览器/BFCache/设备；身份复核不提供跨请求原子快照，现有雪场DTO无客户端版本前置条件/创建幂等键。Kafka/供应商/生产存储、容器/签名包及远程CI仍待验；D-49/D-50/D-09未实施，整体项目未完成，Docker未启动/重启。

2026-11-03 文章完整响应与生命周期续验：真实管理HTTP55项（新增文章4项）与后置持久核对通过，覆盖草稿→发布→已发布编辑→撤回→再发布→软删除、self/selected范围和实际读取期撤权；两篇软删物理行、版本6/2、首次发布时间、八条文章Outbox/八条成功审计及一条分类事件核对，总Outbox22条。三次临时服务均停止。本轮仅联调夹具改动，生产业务保持；本仓1240单测+8工具、173HTTP框架与build通过。见[工程说明](../../../docs/engineering/article-lifecycle-http-validation.md)与[本仓证据](../../../docs/validation/article-reads-20261103.json)。OpenAPI1.51.1/143操作、24迁移保持。模拟Hooks/EventTarget和Node Cookie不计真实浏览器/BFCache/设备验收；身份复核不构成跨请求原子快照，文章既有DTO无版本条件/创建幂等键。Kafka/供应商/存储、容器/签名包及远程CI仍待验；D-49/D-50/D-09未实施，整体项目未完成，Docker未启动/重启。

2026-11-03 动态字段完整响应续验：真实管理HTTP51项（新增字段2项）及后置持久核对通过；字典选项字段创建/修改/启用/停用最终版本4、旧版本409、分组保护409、默认值/字典关联、分组修改/停用及七条成功审计核对，读取期实际撤权拒绝发布。临时服务已停止。本轮仅联调夹具新增字段场景断言，生产业务保持；1240单测+8工具、173HTTP框架与build通过。见[工程说明](../../../docs/engineering/custom-field-http-validation.md)与[本仓证据](../../../docs/validation/field-reads-20261103.json)。OpenAPI1.51.1/143操作、24迁移保持。生命周期为模拟Hooks/EventTarget，Cookie为Node适配，身份前后复核不构成跨请求原子快照；真实浏览器/BFCache/设备、Kafka/供应商、容器/签名包和远程CI仍待验。D-49/D-50/D-09未实施，整体项目未完成，Docker未启动/重启。

2026-11-03 权限目录续验：管理真实HTTP49项（新增权限4项）与后置持久核对通过，完整目录/子树投影、可配置普通账号创建目录/菜单/按钮并编辑/停用、含子节点菜单409、非system_admin同步403及实际读取期撤权均验。精确核对三节点父子/类型/状态/可见性和五条同操作者成功审计，临时服务均停止。本轮仅后置夹具新增权限场景断言，生产业务保持；check1240单测+8源码CLI、173HTTP框架及build通过。见[后端说明](../../../docs/engineering/permission-catalog-http-validation.md)与[本仓证据](../../../docs/validation/catalog-reads-20261103.json)。OpenAPI1.51.1/143操作和24迁移保持。身份复核不承诺跨请求原子快照，Cookie为Node适配、页面为模拟生命周期；真实浏览器/BFCache/设备、Kafka/供应商/容器/签名包及远程CI仍待验，D-49/D-50/D-09未改，整体目标未完成，Docker未启动/重启。

2026-11-03 角色读取与授权目录续验：管理真实HTTP45项（新增角色3项）与后置持久核对通过，完整角色/授权目录投影、后续空页、自定义角色selected范围及范围外403、真实读取期撤权均验；原账号/商家/收益/审计/RAG事件断言保持，临时服务均停止。本轮仅后置夹具新增角色场景断言，生产业务保持；check1240单测+8源码CLI、173HTTP框架及build通过。见[工程说明](../../../docs/engineering/role-read-http-validation.md)与[本仓证据](../../../docs/validation/role-reads-20261103.json)。契约1.51.1/143操作和24迁移保持。本轮身份复核不承诺跨请求原子快照，Cookie为Node适配、页面为模拟生命周期；真实浏览器/BFCache/设备、Kafka/供应商/容器/签名包及远程CI仍待验，D-49/D-50/D-09保持，整体目标未完成，Docker未启动/重启。

2026-11-03 收益恢复联调：独立收益真实HTTP8项及既有管理真实HTTP42项通过，分别使用新库/服务；新增收益后置核对2条幂等请求、2任务/30行、28收益、29写审计和2条仅jobId的pending Outbox，验证提交后响应丢失/同键恢复、旧键不覆盖、部分成功、账号/商家隔离及25行提交后撤权拒绝第26行。四次原应用恢复执行后无重复写入，临时服务均已停止。本轮生产业务保持，仅新增收益HTTP夹具、受限恢复控制和独立命令；check1240单测+8源码CLI、173HTTP框架及build通过。见[后端说明](../../../docs/engineering/revenue-recovery-live-http.md)和[本仓证据](../../../docs/validation/revenue-recovery-http-20261103.json)。契约1.51.1/143操作与24迁移保持。CSV恢复绕过Kafka仅调用原应用服务，未验定时器/Inbox/租约到期；本机恢复存储与Cookie为Node适配。浏览器/设备、Kafka/供应商、容器/签名包及远程CI仍待验，D-49/D-50/D-09未改，整体目标未完成，Docker未启动/重启。

2026-11-03 账号读取续验：管理真实HTTP42项（新增账号3项）及后置核对通过：完整原始VO、本人self范围、后续空页、另一账号404和实际读取期撤权；原账号/商家关联及收益保持，临时服务已停止。本轮只增加HTTP夹具核对；冻结安装、check1240单测+8源码CLI、173HTTP框架及build通过。见[本仓证据](../../../docs/validation/account-reads-20261103.json)。契约1.51.1/143操作、24迁移保持。真实浏览器/BFCache、设备、完整Kafka、供应商、容器/签名包及远程CI仍待验，D-49/D-50/D-09未改，整体目标未完成；Docker未启动/重启。

2026-11-03 商家收益明细续验：真实管理HTTP39项（新增4项收益）及后置数据库核对通过；本人123.45与另一商家678.90隔离、后续空页/日期空区间、外部雪场404、实际撤权及范围冲突403均验，原收益未改，临时服务已停止。仅新增HTTP夹具的只读结果断言，生产业务/协议不变。冻结安装、完整check1240单测+8源码CLI、173HTTP/框架及build通过，见[本仓证据](../../../docs/validation/merchant-revenue-20261103.json)。OpenAPI1.51.1/143操作和24迁移保持。列表/汇总非原子快照；真实浏览器/可见性/BFCache、设备、供应商、Kafka/容器/签名包与远程CI仍待验，D-49/D-50/D-09未改，整体目标未完成。Docker未启动或重启。

2026-11-03 商家经营概览续验：真实管理HTTP35项（新增4项）及后置数据库核对通过，验证本人123.45与另一商家678.90隔离、外部雪场拒绝、独立面板授权和实际读取期撤权。首个临时环境因凭据未传给客户端而主动关闭，未算成功；新环境通过并停止，两轮日志保留。只补充HTTP测试夹具的返回归属断言，生产协议/数据库保持；冻结安装、完整check1240单测+8源码CLI、173HTTP/框架及build通过，见[本仓证据](../../../docs/validation/merchant-dashboard-20261103.json)。OpenAPI1.51.1/143操作和24迁移保持。三个业务读取不是原子快照；当前浏览器/可见性/BFCache、设备、供应商、Kafka/容器/签名包及远程CI仍待验，D-49/D-50/D-09保持待决，整体目标未完成。Docker未启动或重启。

2026-11-03 原生Kafka诊断：[Windows原生Kafka实验](../../../docs/engineering/native-kafka-validation.md)已提供复现入口。新增隔离Windows Kafka验收入口与20项控制能力测试；官方Kafka4.1.1发行包SHA-512一致。三轮分别定位CLI UUID日志混入、本机JDK内部socket临时目录，以及topic删除目录重命名AccessDenied导致broker关闭。前两项已修复，第三轮完整集成仍为2文件失败、1项失败/8项跳过、0项通过，不能记为Kafka验收成功。未放宽清理断言，三轮专用PG/JVM/控制入口均已停止，失败日志保留。本仓冻结安装、完整check1240单测+8源码CLI、173HTTP/框架及build通过，但不替代失败的Kafka集成；[本仓证据](../../../docs/validation/native-kafka-20261103.json)将engineeringChecksPassed与nativeIntegrationPassed=false分开记录。OpenAPI1.51.1/143操作与24迁移保持；Docker及其WSL发行版未启动/重启/借用。当前完整Kafka、浏览器/设备、真实供应商、容器/签名包及远程CI仍待验；D-49/D-50/D-09未改，整体目标未完成。

2026-11-03 工作台汇总读取与联调：现行管理真实HTTP31项及后置持久核对通过；工作台新增四项，核对两个商家收益、全局/本人计数、null裁剪、实际撤权和冲突拒绝；只增加隔离测试夹具数据，生产协议保持。本仓冻结安装、完整check1220单测+8源码CLI、173HTTP/框架及构建通过，见[本仓证据](../../../docs/validation/dashboard-lifecycle-20261103.json)。OpenAPI1.51.1/143操作与24迁移保持；首轮29通过/2夹具授权失败已保留，补齐既有本人资料读取grant后在新库31通过，两轮均停止。浏览器/设备、真实供应商、Kafka投递、容器/签名包及远程CI仍待验；D-49/D-50/D-09未改，整体目标未完成，Docker未启动/重启。

2026-11-03 事件读取与恢复保护：Web生产事件读取与门禁完成真实HTTP复验，27项及后置持久核对通过；本仓业务协议保持，冻结安装、完整check1220单测+8源码CLI、173HTTP/框架及构建通过，见[本仓证据](../../../docs/validation/event-lifecycle-20261103.json)。OpenAPI1.51.1/143操作与24迁移保持；未启动或重启Docker。浏览器/BFCache、设备、真实供应商、Kafka投递、容器/签名包及远程CI仍待验；D-49/D-50/D-09未改，整体目标未完成。

2026-11-03 项目知识与事件运维联调：[知识与Outbox持久验证](../../../docs/engineering/content-events-http-validation.md)补齐本轮联调。管理真实HTTP现27项（新增4项知识、2项事件）及后置持久核对通过；知识创建/更新/发布/撤回/再发布/软删除、旧版本及敏感信息拒绝、可配置角色越权拒绝、微秒事件定位和单次人工重试已验。七条知识事件/审计、首次发布时间/版本7、事件原ID/Attempts5/预算5→13及唯一重试审计精确匹配。本仓冻结安装、完整check/HTTP框架测试与build通过；[本仓证据](../../../docs/validation/content-events-http-20261103.json)保存源码、日志和清理核对。首轮failed带租约的测试数据被数据库约束正确拒绝，修正夹具后在新库通过，失败日志保留；两次临时环境均停止。Kafka投递、浏览器/设备、供应商、容器/签名包及远程CI仍待验，D-49/D-50/D-09未改，整体目标未完成。

2026-11-03 RAG来源真实HTTP续验：[来源持久验证](../../../docs/engineering/rag-source-http-validation.md)补齐隔离库夹具及精确审计/事件/代次断言。现行管理联调21项（新增6项RAG）及后置持久核对通过；包含原始响应白名单、真实向量删除、四种越权拒绝、版本冲突、同状态空操作、成功提交后客户端响应丢失注入与核对恢复、并发单赢家。最终控制版本7/代次6、六条审计和四条pending重建事件精确匹配，业务来源及其他RAG记录保持。三仓OpenAPI1.51.1/143操作、24迁移保持。各仓冻结安装通过；Backend1220单测+8源码CLI、173HTTP/框架及构建，Web完整check2222业务+20发布+8源码CLI与官网/Admin双强制构建/standalone校验，App1163业务+8源码CLI+10产物CLI、Doctor20/20及三平台导出/88文件封存迁移校验均通过。结果见[本仓摘要](../../../docs/validation/rag-source-http-20261103.json)。首轮17通过/4个旧测试因陈旧身份快照失败已保留并停止；修正测试身份恢复，在新库复验。最后补充原始HTTP投影后另起全新库21项与持久验证再次通过，不累计重复测试。Node/PostgreSQL均已停止。Kafka投递、供应商、浏览器/设备、容器和远程CI仍待验；D-49/D-50/D-09未改，整体目标未完成，Docker未启动/重启。

2026-11-03 RAG来源读取与命令核对续验：D-52已确认，[审计存储引用声明](../../../docs/engineering/audit-citations-contract.md)修正为可空JSON，契约1.51.1/143操作。36项审计HTTP专项通过（新增7），完整check1220单测+8源码CLI、173HTTP/框架与构建通过。未改业务返回、权限或迁移；本轮未重跑真实数据库/管理HTTP，见[本仓证据](../../../docs/validation/rag-source-lifecycle-20261103.json)。

2026-11-03 AI审计配套：[独立管理HTTP](../../../docs/engineering/admin-authorization-http-validation.md)现行十五项与后置持久核对通过。夹具增加四类会话、两条大ID消息及历史引用；验证自定义审计角色/user:self、他人404、即时撤权和唯一成功正文访问审计，原消息未变。两轮临时Nest/PostgreSQL均已停止，首轮旧CSRF缓存断言失败日志保留。[本仓证据](../../../docs/validation/ai-audit-lifecycle-20261103.json)记录冻结安装、1220单测+8源码CLI、166HTTP/框架及build通过；既有lint警告1条。生产后端/OpenAPI1.51.0/143操作及24迁移保持，D-52注解差异待确认，本轮未重复839项全库套件。

2026-11-03 操作日志配套：[独立管理HTTP](../../../docs/engineering/admin-authorization-http-validation.md)现行十二项及后置持久核对通过；24迁移、双seed、前后结构复验完成，本次Nest/PostgreSQL已停止。独立冻结安装、完整check1220单测+8源码CLI、166HTTP/框架与build通过；lint仍有既有no-unsafe-finally警告1条，无新增警告。[本仓证据](../../../docs/validation/operation-log-lifecycle-20261103.json)绑定运行日志及源码；生产后端代码和OpenAPI1.51.0/143操作保持，无新增迁移，本轮未重复上阶段839项数据库套件。Docker保持不启动/重启。

2026-11-03 D-51已完成并验证：PostgreSQL账号5次/60秒与可信IP30次/60秒双桶原子计数，429含Retry-After、存储故障503拒绝；Web官网/Admin和App通用限流反馈且不重放登录。三仓契约1.51.0/143操作；Backend1220单测+8源码CLI、166HTTP/框架、839真实数据库测试及构建，Web2007业务+20发布+8源码CLI及双无缓存构建，App1163业务+18Node工具测试、Doctor20/20、三平台导出及88文件迁移校验全部通过。新增第24项迁移和必填LOGIN_RATE_LIMIT_SECRET，代理仅通过TRUSTED_PROXY_CIDRS显式配置；启动前先部署迁移并配置独立密钥。Docker未启动/重启，D-49/D-50/D-09及生产代理、浏览器/设备、供应商、容器和远程CI仍待完成。 见[登录限流工程说明](../../../docs/engineering/login-rate-limit.md)与[本仓验证摘要](../../../docs/validation/login-limit-20261103.json)。

2026-11-03 Expo交付阶段配套：独立冻结安装、1192单测+8源码导出CLI及build通过，见[本仓摘要](../../../docs/validation/export-artifact-20261103.json)。此记录对应D-51前源码；后续认证变更和新增迁移以新验证摘要为准。

2026-11-03 字典读取联调：现行独立Web管理HTTP十一项及本仓后置核对通过，新增读取父子字典及停用子项；本次Node/PG已停止。冻结安装、完整check1192单测/8导出CLI、158HTTP/框架测试、build/OpenAPI导出通过。本轮只增加测试夹具父子数据和核对，生产代码/协议保持；[结果与范围](../../../docs/validation/dictionary-recovery-http-20261103.json)已记录，Docker不重启。

2026-11-03 字段恢复联调：独立Web新增字段/分组生产读取器，现行管理HTTP十项及本仓后置持久核对通过，[入口及摘要](../../../docs/engineering/admin-authorization-http-validation.md)已更新；临时Node/PG已停止。本仓冻结安装、check（1192单测及8导出CLI）、158HTTP/框架测试、build/OpenAPI导出通过。本轮未改后端业务或协议，Docker保持现状。

2026-11-03 管理授权真实HTTP：[本仓临时库与编译服务入口](../../../docs/engineering/admin-authorization-http-validation.md)已提供；独立Web生产模型九项通过，持久核对确认字段/角色撤权、商家隔离、八次拒绝无成功审计及单条Outbox。原公开内容八项也在新临时库回归通过；两次成功实例均已停止。OpenAPI1.50.2/143操作与业务协议保持，D-49商家建档仍待确认。

2026-11-03 独立源码交付复验：675文件副本在全新store安装后通过1192单测、158项HTTP/框架测试、8项导出测试及构建/契约导出。Prisma使用副本内经版本核验的引擎；首次生成中断单独记录。结果与日志摘要见[本仓证据](../../../docs/validation/source-export-20261103.json)，复现步骤见下方工程入口。

独立交付入口：[源码导出与冷安装](../../../docs/engineering/source-export.md)提供 pnpm source:export，保留当前未提交源码、排除本机依赖/部署环境，并生成逐文件SHA-256清单；仅导出本仓，不启动其他项目。

2026-11-03 App路由阶段配套复验：本仓冻结安装、完整check（138文件1192单测）、8文件158项HTTP/框架测试、build及编译后OpenAPI导出通过，日志app-recovery-保留；lint保留既有原生数据库脚本no-unsafe-finally警告。本仓业务与数据库未改，OpenAPI1.50.2/143操作保持，本轮未重复执行既有真实数据库830项或官网HTTP八项。Docker保持原状，容器与供应商验收继续待办。

2026-11-03 官网真实HTTP续验：[本仓隔离编译服务验收](../../../docs/engineering/public-content-http-validation.md)新增独立临时库/fixture入口，23迁移、双seed、前后db:verify及持久断言通过，独立Web生产读取器8项真实HTTP通过；末次Node/PG已停止，数据与日志保留D:/linji-public-live/20261103/runs/linji-public-http-nrXLFC，首轮成功记录另保留。本仓冻结安装/check1192单测、158HTTP框架、build/编译后OpenAPI导出通过，lint保留既有原生数据库脚本警告。未改业务协议/迁移，OpenAPI1.50.2/143操作保持；真实浏览器/容器/供应商仍待验。

2026-11-03 Web路由恢复阶段配套复验：本仓冻结安装、完整check（138文件1192单测）、8文件158项HTTP/框架测试、build及编译后OpenAPI导出通过，日志route-state-保留；lint保留既有原生数据库验收脚本no-unsafe-finally警告。本轮没有修改后端业务、数据库或OpenAPI1.50.2/143操作，未重跑此前830项真实数据库套件；容器/供应商/浏览器与设备验收仍待完成。

2026-11-03 官网详情/评论配套复验：本仓冻结安装、完整check（138文件1192单测）、8文件158项HTTP/框架测试及build/编译后OpenAPI导出通过，日志public-detail-保留。lint保留既有原生数据库脚本no-unsafe-finally警告；本轮仅Web实现变化，后端业务、迁移与契约1.50.2/143操作保持。此前830项真实数据库证据单独保留；Docker容器与真实供应商联调仍待完成。

2026-11-03 官网公开列表配套复验：本仓冻结安装、完整check（138文件1192单测）、8文件158项HTTP/框架测试及build/编译后OpenAPI导出通过，日志public-directory-保留，lint保留既有原生数据库脚本no-unsafe-finally警告。本轮仅官网实现变化，后端业务、迁移与契约1.50.2/143操作保持；此前830项真实数据库证据单独保留，Docker容器与真实供应商联调仍待完成。

2026-11-03 管理端媒体选择配套复验：本仓冻结安装、完整check（138文件1192单测）、8文件158项HTTP/框架测试及build/编译后OpenAPI导出通过，日志media-picker-保留。lint通过并保留既有原生数据库脚本no-unsafe-finally警告；本轮没有后端业务、迁移或契约1.50.2/143操作变化。此前真实Windows PostgreSQL/pgvector830项证据单独保留；Docker容器和真实供应商联调仍待完成。

新增可选 `pnpm test:native-db`：[Windows 隔离 PostgreSQL 验收](../../../docs/engineering/native-postgres-validation.md)在显式指定的便携 PostgreSQL 17/pgvector 下创建临时集群，执行迁移、双 seed、结构校验及完整数据库套件，随后停止本次实例。使用独立数据目录和回环端口，不读取既有 DATABASE_URL，不安装系统服务或操作 Docker；实际结果见本轮验收记录。

2026-11-03 原生数据库实测：PostgreSQL17.11/pgvector0.8.1的23迁移、双seed、前后结构校验及34文件830项数据库测试通过，临时实例已停止，见本仓[脱敏摘要](../../../docs/validation/native-postgres-20261103.json)。含此前未运行的AI生成期撤权/来源变化七项。首轮管道等待和专用库名保护失败均保留，未放宽测试。本仓冻结安装、完整check（1192单测）、158HTTP框架及构建/契约导出通过，日志native-postgres-保留。Docker、真实Kafka/模型/存储、容器和设备验收不计入本结果。

2026-11-03 官网详情分享配套复验：本仓冻结安装、完整check（138文件1192单测）、8文件158项HTTP/框架测试和构建/编译后OpenAPI导出通过，日志public-metadata-保留。本轮仅Web实现变化，本仓业务、迁移和契约1.50.2/143操作保持；Docker不重启，真实数据库/容器验收继续待办。

2026-11-03 官网首页配套复验：本仓独立冻结安装、完整check（138文件1192单测）、8文件158项HTTP/框架测试及build/编译后OpenAPI导出通过，日志home-response-保留。业务、迁移及契约1.50.2/143操作保持。登录限流仍未实现，精确协议D-51待确认；D-49/D-50另待确认，Docker不重启，真实数据库/容器继续待验。

2026-11-03 管理端会话配套复验：本仓独立冻结安装、完整check（138文件1192单测）、8文件158项HTTP/框架测试及build/编译后OpenAPI导出通过，日志admin-session-保留。后端业务、迁移及契约1.50.2/143操作保持；Docker不重启，真实数据库/容器继续待验，D-49/D-50仍待确认。

2026-11-03 官网会话配套复验：本仓独立冻结安装、完整check（138文件1192单测）、8文件158项HTTP/框架测试及build/编译后OpenAPI导出通过，日志public-session-保留。后端业务/迁移/契约1.50.2/143操作保持；Docker不重启，真实数据库/容器继续待验，D-49/D-50仍待确认。

2026-11-03 当前契约1.50.2/143操作：[全局雪场响应声明](../../../docs/engineering/admin-resort-response-contract.md)补齐现有列表/详情/写入VO及共享字段目录元数据；运行时、路由和数据库规则保持。冻结安装、完整check（138文件1192单测）、8文件158项HTTP/框架测试及build/OpenAPI导出通过。D-49未确认、未实施；Docker不重启，真实数据库/容器验收继续待办。下方日期段落为历史结果。

2026-11-03 现行契约1.50.1/143操作：[全局雪场可空数值类型修正](../../../docs/engineering/admin-resort-contract-types.md)为创建/编辑的merchantId/rating声明正确数值类型，运行时和数据库语义保持。新HTTP契约回归先失败后通过，完整1192单测、157项HTTP/框架测试及build/OpenAPI导出通过。商家资料管理D-49另待确认，未实现、未迁移；Docker不重启，真实数据库/容器验收待办保留。

2026-11-03 官网公开配置配套复验：本仓独立冻结安装、完整check（138文件1192项）、8文件156项HTTP/框架测试及build通过，进程退出0，日志public-config-保留。无后端业务、接口或迁移变化，GET /public/config固定公开投影及OpenAPI1.50.0/143操作保持。Docker只读查询返回引擎管道不存在，按用户决定不重启；新增RAG/授权数据库及容器验收继续待办。

2026-11-03 App启动/平台信息配套复验：本仓独立冻结安装、完整check（138文件1192项）、8文件156项HTTP/框架测试及build通过，进程退出0。无后端业务、接口或迁移变更，OpenAPI1.50.0/143操作保持；同步历史工程文档中RAG“待确认”的过期说明。日志public-info-保留；Docker不重启，新增RAG/授权数据库和容器验收继续待办。

2026-11-03 App个人中心配套复验：本仓独立冻结安装、完整check（138文件1192项）、8文件156项HTTP/框架测试及build通过，进程退出0，日志profile-home-保留。客户端仍通过既有GET /auth/me和HTTP会话协议读取权限；本仓没有业务代码、迁移或OpenAPI1.50.0/143操作变化。Docker按用户决定不重启，新增RAG/授权数据库及容器验收继续待办。

2026-11-03 App登录页配套复验：本仓独立冻结安装、完整check（138文件1192项）、8文件156项HTTP/框架测试及build通过，日志auth-screen-保留。本轮未修改后端业务或OpenAPI1.50.0/143操作，原生/Web认证和注册不自动登录规则保持；Docker不重启，新增在途RAG/授权数据库用例及容器验收仍待完成。

2026-11-03 当前RAG修复：[生成期间来源快照复核](../../../docs/engineering/rag-live-evidence.md)复用现行公开来源SQL，在模型调用、片段、完成和保存边界检查本轮真实引用的分块/正文与业务状态。3项先复现后修复，专项44单测及二文件20项AI HTTP通过，完整冻结安装/check（138文件1192项）、8文件156项HTTP/框架测试、build及编译后契约导出通过。重建数据库测试修正后lint/typecheck再次通过，新增4项真实数据库变化用例待执行。OpenAPI1.50.0/143操作保持，无新依赖/迁移；Docker不重启，完整三仓结果见阶段记录。

2026-11-02/03 当前 AI 修复：[流式会话、权限及有效 RAG 范围复核](../../../docs/engineering/ai-stream-authorization.md)已补齐每片段、保存前后和幂等回放检查，撤权后停止后续输出，取消上游并清理未完成尝试。4项用例先复现失败后修复；专项34单测/13项HTTP及最终冻结安装/check（137文件1172项）、149项HTTP/框架测试/build/编译后契约导出通过，新增3项真实数据库撤权验收待Docker恢复后执行。OpenAPI1.50.0/143操作保持，提交竞争与来源变化边界见说明，最终三仓结果见阶段记录。

2026-11-02 App 原生工程配套复验：本仓冻结安装、完整 check（136 文件 / 1148 单测）、7 文件 / 143 项 HTTP/框架测试及 build 通过，日志 native-release- 保留。本轮未改 Backend 实现、迁移或 OpenAPI 1.50.0 / 143 操作；Docker 保持原状，数据库/容器验收继续待办。

2026-11-02 Web独立发布包配套复验：本仓冻结安装、完整check（136文件1148单测）、7文件143项HTTP/框架测试及build通过，日志standalone-release-保留。本轮未改后端业务、迁移或OpenAPI1.50.0/143操作；Docker保持不重启，数据库/容器及生产验收仍待完成。

2026-11-02 授权续验：[全部143操作的路由声明与127受保护操作的拒绝矩阵](../../../docs/engineering/route-authorization-validation.md)已补齐，包含同一JWT撤权/恢复/会话撤销。角色列表新增Prisma偏移量上限校验与单元/HTTP回归，无接口或迁移变化；本仓冻结安装、完整check（136文件1148单测）、7文件143项HTTP/框架测试、build及编译后契约导出通过。Docker保持不重启，数据库与容器复验仍待办。

2026-11-02 模型传输续验：[Chat/Embedding 响应体取消、异常流与重定向处理](../../../docs/engineering/model-provider-transport.md)已修复，新增真实回环 HTTP 验证。本仓冻结安装、lint/typecheck、136文件1145单测、130项HTTP/框架测试、build与编译后契约导出通过。保持 OpenAPI1.50.0/143操作及RAG/会话/客户端SSE契约；实际供应商、模型ID、数据库和设备验收仍单独待办。

2026-11-02 Kafka 连接已支持 [TLS/SASL、私有 CA 和双向 TLS](../../../docs/engineering/kafka-transport-security.md)。生产者与消费者使用同一配置，默认本地明文行为保持；生产环境模板需替换集群凭证并按需挂载只读 PEM。本仓冻结安装、lint/typecheck、135 文件1108单测、130项HTTP/框架测试、build及编译后OpenAPI导出通过；契约保持1.50.0/143操作。回环专项与真实集群验收边界见说明，历史数据库结果不代表本次通过。

2026-11-02 DDD 内层续验：[九个上下文依赖检查与邮箱策略端口](../../../docs/engineering/ddd-boundary-validation.md)已实现，覆盖40个Domain和118个Application生产文件。本仓冻结安装、lint/typecheck、133文件1078单测、6文件130项HTTP/框架测试、build及编译后OpenAPI导出通过。系统配置保持原邮箱语义、版本及审计规则，无新接口/迁移。用户已确认暂不重启Docker，本轮真实数据库/容器复验待办；下方823项数据库结果属于历史阶段。

独立发布入口：[容器构建、迁移工具、配置、停机与验收](../../../docs/engineering/container-release.md)。`Dockerfile` 提供 runtime/tools 两个目标，`infra/compose.release.yml` 提供 API 发布配置，`pnpm test:container` 使用自行创建的隔离数据库验收。当前实测状态以该文档结果段为准。

独立的 NestJS + TypeScript DDD 模块化单体，为官网、管理端和 Expo App 提供版本化 `/api/v1` HTTP API。后端独占 PostgreSQL/pgvector、Prisma、Kafka/Outbox/Inbox，以及对话/Embedding 模型接入。本仓可独立克隆、安装、迁移、测试和发布，不依赖前端或父目录源码。

当前契约 OpenAPI **1.50.2 / 143 个操作**。2026-11-02 本仓冻结安装、lint/typecheck、**131文件1048项**单测、**823项**真实数据库回归、**127项**HTTP e2e及build通过；Kafka恢复/再平衡与真实Nest关闭/HTTP排空/RAG重放共**9项**通过。修复后台任务排空与连接关闭顺序、契约导出误启动消费者。23迁移/双seed/前后校验、不可达依赖下契约导出及清理断言通过。初轮并发检查失败已保留并复验；API/Node依赖/migration未变，实际浏览器/设备、供应商、生产信号/灾备和远程CI仍待验。

最新验收：[后台任务停机与资源顺序](../../../docs/engineering/worker-shutdown.md)、[Kafka恢复与再平衡](../../../docs/engineering/kafka-recovery-validation.md)、[MinIO源码构建与真实私有存储](../../../docs/engineering/minio-source-storage.md)、[Expo Web认证真实HTTP](../../../docs/engineering/expo-web-auth-http-validation.md)、[App知识列表真实HTTP](../../../docs/engineering/knowledge-list-http-validation.md)、[App发布编辑与实际扫描](../../../docs/engineering/composer-http-validation.md)、[App社区真实HTTP与持久化](../../../docs/engineering/community-mobile-http-validation.md)、[App AI真实HTTP与pgvector](../../../docs/engineering/ai-mobile-http-validation.md)、[独立构建与编译后HTTP](../../../docs/engineering/independent-start-validation.md)、[雪场列表与收藏](../../../docs/engineering/resort-list-http-validation.md)。原生设备、真实模型/Embedding、生产恢复及远程CI仍待验。[README历史记录](../../../docs/engineering/history/readme-progress-20261102.md)保留各阶段事实和失败，不替代当前验收。
