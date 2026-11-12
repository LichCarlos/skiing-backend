# README历史进度（截至2026-11-02）

本文归档原README首页记录。版本、测试数量和未完成项均属于各自阶段，当前启动方式与状态以[本仓README](../../../README.md)为准；旧记录不作为当前全部验收结论。

2026-11-02 App资料配套：新增[专用HTTP夹具与持久断言](../profile-http-validation.md)，生产实现/API/schema保持。两项真实App→Nest/PostgreSQL联调、昵称/头像语义及2+1次审计验证通过；23迁移/双seed及前后db:verify通过，模拟数据/本轮服务已清理。冻结安装、lint/typecheck、130文件1039单测和build通过；未重跑完整823数据库/126HTTP。OpenAPI1.50.0保持，原生/生产/远程CI及整体目标仍未完成。

2026-11-02 App设置联调配套：生产代码/API/schema未变；新增受专用可销毁库与显式确认保护的[HTTP模拟夹具](../settings-http-validation.md)。App两项真实HTTP通过，数据库另验两个用户各一次成功改密及零有效会话；23迁移/双seed/db:verify通过并已清理本轮模拟数据与容器。独立冻结安装、lint/typecheck、130文件1039单测和build通过；不重复声称本轮重跑823数据库/126HTTP。契约1.50.0保持，生产/设备/远程CI仍待验，下方为历史证据。

2026-11-02 D-48：PATCH /admin/users/:id/password 已实施，受保护system_admin + 独立grant + user all；密码、目标全部会话撤销、审计同Serializable事务，登录以验证过的hash做条件更新防止漏撤销。见[工程说明与复现](../admin-password-reset.md)。冻结安装、完整check130文件1039项、126HTTP、34文件823数据库测试、23迁移/双seed/db:verify和build通过；浏览器5项及三次审计/零有效会话断言通过。API1.50.0/143操作，无新依赖/迁移；远程CI/生产恢复仍待验，下文为历史证据。

2026-11-02 App收藏流程配套：本仓代码/API/schema未变；独立冻结安装、lint/typecheck、128文件1017项单测与build通过。收藏仍沿用本人列表、幂等PUT/DELETE及member:favorite:toggle，客户端不传账号ID。本轮未重跑HTTP/数据库/供应商集成，契约1.49.0及哈希保持；README现行契约段落已修正旧版本值。

App本人动态配套最终结果：后端独立冻结安装、lint/typecheck、128文件1017项单测与build通过；业务/API/schema未变，本轮未重跑HTTP或真实数据库集成，前阶段126HTTP/810数据库只作为历史证据。契约1.49.0保持，未提交/推送/部署。

2026-11-02 App本人动态配套：本仓业务、API、schema与依赖未变；App沿用read-own/update-own及原DELETE完成客户端焦点/删除恢复，不新增服务端协议。后端按本阶段执行独立冻结安装/check/build，实际结果见阶段交付记录；不把客户端替身测试当作新增数据库或设备验收。

2026-11-02 AI管理浏览器配套：新增隔离库合成夹具create/verify/cleanup，真实Next/Nest/PostgreSQL浏览器8项通过，服务端成功审计、409无成功控制审计、零分块和Outbox持久事件另有断言。见[夹具和复现](../ai-browser-fixture.md)。没有新增API、依赖或migration；本轮不调用模型/Broker，其他真实集成与项目整体验收仍未完成。下文为历史阶段记录。

2026-11-02 AI管理数据库续验：新增隔离库23项迁移、两次seed和db:verify通过；会话审计11项、RAG控制14项、全局雪场34项真实数据库专项通过；最终全库33文件/810项、单测1017项、HTTP126项及lint/typecheck/build通过。修复RAG并发SQL错误包装漏映射409，以及保留图片缺少事务内就绪校验。新增[数据库验收记录](../ai-operations-database-validation.md)，包含独立复现、首次失败与修复、测试替身和剩余边界。OpenAPI保持1.49.0，无新依赖/迁移/API；浏览器、真实provider及生产恢复仍待验收，项目整体未完成。下文带日期段落为历史记录。

2026-11-02 AI 会话审计 HTTP 验收：新增29项，覆盖真实 Nest/Guard/DTO/响应链路及正文访问失败脱敏；完整 HTTP4文件/126项通过。修正8处旧契约版本断言及全局雪场读取的服务端操作者参数断言。独立冻结安装、lint/typecheck、128文件/1011项单测与 build 通过。API保持1.49.0，无依赖/迁移变更；Docker Linux engine不可连接，真实数据库和第23迁移未验收。见[工程记录](../ai-operations.md)。项目整体未完成，下方日期记录为历史证据。

2026-11-01 D-44 至 D-47 定版与验收：公开雪场标签、全局雪场字段/资产授权、RAG 来源运维及 AI 会话正文审计已实现；正文读取要求独立权限、`user` 数据范围和 1–500 字原因，读取与成功审计同事务。详见[AI 运维工程说明](../ai-operations.md)。OpenAPI 1.49.0；lint/typecheck 与 128 个测试文件、1011 项单测通过。本轮未运行数据库测试或 migration；真实 Kafka/Embedding、浏览器/设备及供应商联调仍待验收。未提交/推送/部署，项目整体未完成。

2026-11-01 收益恢复：完成管理员读取/单条幂等和CSV持久导入任务、Outbox/Inbox、租约恢复、逐行事务及结果查询；详见[恢复工程说明](../revenue-recovery.md)。OpenAPI1.48.0，22个migration目录。当前lint/typecheck/build、125文件/977单测、3文件/97 HTTP e2e、31文件/778真实PostgreSQL测试及前后db:verify通过。测试后保留原管理员及1条pending Outbox，无业务夹具残留。三端真实浏览器/设备/供应商及项目整体验收未完成；未提交/推送/部署，下文为历史阶段。

2026-11-01 消息任务页面配套验证：新增Outbox真实HTTP/PostgreSQL时间精度测试，证明微秒CreatedAt经毫秒VO返回后的等值筛选漏行与窗口定位；事件专项25项通过，生产代码/协议不变。见[Outbox工程说明](../outbox-management.md)。冻结安装、lint/typecheck、942单测/97 HTTP/747数据库、前后db:verify（20迁移）及build通过。原管理员、四项active账号权限、原pending Outbox和无测试残留已核对；OpenAPI1.46.0三仓哈希不变，无新依赖/迁移。Web1308项与双应用构建、App342项/Doctor20/20/三平台导出通过；日志event-pages-保留。真实供应商/生产worker恢复与项目整体验收仍缺，未提交/推送/部署，下文为历史阶段。

2026-11-01 商家雪场页面配套验证：本仓代码/依赖/迁移及OpenAPI1.46.0保持；独立冻结安装、lint/typecheck、122文件942单测、3文件97 HTTP、31文件746真实数据库、build及前后db:verify（20迁移）通过。四类写命令沿用[事务授权规则](../merchant-resort-transaction-authorization.md)，Web改进不扩大范围或新增客户端版本/幂等协议。原active管理员、四项账号权限与pending Outbox保留，文章/动态/评论/日志/RAG为0；容器及3010/3001进程保持。日志merchant-pages-保留，未提交/推送/部署；真实供应商与整体验收仍缺，下文为历史阶段。

2026-11-01 资产删除事务最终验证：Serializable内重读账号/角色/入口/动作及asset范围；持Asset锁后额外读取主库最新引用，防止旧快照漏掉已提交头像/图片关联，状态与审计原子提交。9种Guard后撤权均403，真实行锁状态竞争409，确定性头像/社区引用竞争仍422；详见 [工程说明](../asset-deletion-authorization.md)。专项授权/仓储/应用47单测、资产22数据库、关联三文件102项通过；完整122文件942单测、3文件97 HTTP、31文件746数据库、冻结安装、lint/typecheck/build及前后db:verify（20迁移）通过。Web1079项/双应用构建、App342项/Doctor20/20/三平台导出配套通过。OpenAPI1.46.0三仓一致，无迁移/依赖变化；原账号、权限、pending Outbox、容器与进程保留，夹具无残留，日志asset-pages-保留。未提交/推送/部署，真实供应商、浏览器/设备、RAG运维和整体验收仍缺。

2026-11-01 社区审核页面最终配套验证：本仓冻结安装、lint/typecheck、120文件906单测、3文件97 HTTP、31文件736真实数据库、build和前后db:verify（20迁移）通过。Web1001项/双应用构建、App342项/Doctor20/20/三平台导出配套通过；三仓OpenAPI1.46.0哈希不变。原管理员、四项active账号权限、pending Outbox、容器和进程保留，测试业务数据无残留，日志moderation-pages-保留。未提交/推送/部署，项目整体未完成，下文为历史阶段。

2026-11-01 社区审核页面配套验证：本仓代码/依赖/迁移及OpenAPI1.46.0保持；冻结安装、lint/typecheck、120文件906单测、3文件97 HTTP及build通过。真实数据库完整回归进行中，最终结果另见最新记录。本轮管理端完善既有API-M08交互，不增加审核版本条件或端点；项目整体未完成，下文为历史阶段。

2026-11-01 项目知识契约最终验证：冻结安装、lint/typecheck、120文件906单测、3文件97 HTTP、31文件736真实数据库、build/OpenAPI及前后db:verify（20迁移）通过。Web909项/双应用构建、App342项/Doctor20/20/三平台导出配套通过；OpenAPI1.46.0三仓哈希一致。仅原管理员、四项active账号权限与pending Outbox保留，文章/动态/评论/日志/RAG均为0，原容器/进程保留。失败与最终knowledge-pages-日志保留，未提交/推送/部署；项目整体未完成，下文为历史阶段。

2026-11-01 项目知识页面配套：修正创建/更新DTO的sourceUrl Swagger类型为nullable string，OpenAPI1.46.0三仓同步。见 [契约校正说明](../project-knowledge-contract.md)。业务规则、路由、依赖和迁移不变；906单测及97 HTTP、构建通过。首次HTTP回归8项旧版本断言已修正，失败记录保留；完整数据库最终证据另见最新记录。项目整体未完成，下文为历史阶段。

2026-11-01 文章页面最终配套验证：本仓冻结安装、lint/typecheck、120文件906单测、3文件96 HTTP、31文件736真实数据库、build/OpenAPI及前后db:verify（20迁移）通过。Web812项/双应用构建、App342项/Doctor20/20/三平台导出配套通过；三仓OpenAPI1.45.0哈希不变。基线管理员、四项active账号权限、pending Outbox和原进程保留，日志前缀article-pages-；未提交/推送/部署，项目整体未完成。下文为历史进度。

2026-11-01 文章页面配套验证：本仓业务代码、依赖、数据库和OpenAPI1.45.0保持。管理端补齐文章读取/写入交互；本仓独立冻结安装已通过，检查、HTTP、真实数据库及构建正在运行。项目整体未完成。

2026-11-01 文章边界阶段最终验证：冻结安装、lint/typecheck、120文件906单测、3文件96 HTTP、31文件736真实数据库测试、build/OpenAPI及前后db:verify（20迁移）通过。Web699项/双应用构建、App342项/Doctor20/20/三平台导出配套通过。OpenAPI1.45.0三仓哈希不变；原数据和进程保留，未提交/推送/部署，项目整体未完成。日志前缀article-boundaries-。

2026-11-01 文章边界阶段：修正整体 customFields 为 null 被忽略的问题，补齐受保护管理员字段特权和 self/selected/actor 正 int4 校验；原有事务内授权保持，撤权验证扩展至全部八入口。专项69单测、96 HTTP及34知识内容数据库测试通过；OpenAPI1.45.0不变，无新接口、迁移或依赖。见 [文章事务授权与输入边界](../article-transaction-boundaries.md)。本轮完整证据见最终记录；全项目尚未完成，下文为历史阶段记录。

2026-10-31 工作台阶段最终验证：三仓独立冻结安装通过；Backend lint/typecheck、120文件881单测、3文件88 HTTP、31文件728真实数据库、build/OpenAPI与前后db:verify（20迁移）通过；Web完整check699项及官网/Admin build通过；App完整check24文件342项、lint零警告、Doctor20/20与iOS/Android/Web export通过。OpenAPI1.45.0三仓SHA-256一致（7143202ba63822b11c3275ef7c2c466390222cb1fea9716d784cb9d68f60540e）。123份Markdown、691个本地链接有效。原管理员、四项active账号权限、pending Outbox、验证容器及开发进程保留，测试夹具无残留。失败及复验日志dashboard-保留，未提交/推送/部署。仍缺RAG来源运维三接口、AI审计、待确认协议与真实浏览器/设备/供应商验收，项目整体未完成。

2026-10-31 全局工作台阶段：用户已确认API-M01/ADM-01汇总协议，后端与管理端已实现；七面板按授权及既有数据范围读取，商家隔离、精确累计收益与同快照统计。OpenAPI 1.45.0三仓同步。见[工作台工程说明](../dashboard-summary.md)。后端881单测、88 HTTP、728真实数据库及构建通过；三仓完整结果见上方最终记录。RAG运维/AI审计、待确认协议及浏览器/设备/真实供应商等仍缺，项目整体未完成。

认证隔离阶段最终配套验证：119文件873单测、3文件88 HTTP、30文件690真实数据库、lint/typecheck、build/OpenAPI、冻结安装及前后db:verify（20迁移）通过。App342项/Doctor20/20/三平台导出、Web684项/双端构建配套通过。三仓OpenAPI1.44.0哈希一致；原管理员、四项active账号权限、pending Outbox、容器与开发进程保留，未提交/推送/部署。

2026-10-31 App 认证隔离配套验证：本仓业务协议、依赖、数据库与 OpenAPI 1.44.0 不变；独立冻结安装、lint/typecheck、873单测、88 HTTP、690真实数据库、build/OpenAPI及前后db:verify（20迁移）通过，日志前缀session-isolation-。项目整体未完成，真实设备/供应商与管理接口缺口仍待完成。

本阶段最终验证：独立冻结安装、lint/typecheck、119 文件/873 单测、3 文件/88 HTTP、30 文件/690 真实数据库测试、build/OpenAPI 导出及前后 db:verify（20 迁移）通过。测试后仅原 active 管理员、动态/评论/操作日志为 0、四项账号权限 active；原 pending Outbox、验证容器及开发进程保留，未提交/推送/部署。Web 684 项和双端构建、App 303 项/Doctor20/20/三平台导出配套通过。

2026-10-31 App AI 列表配套复验：本仓业务协议、依赖与数据库不变，OpenAPI 仍为 1.44.0；创建会话 DTO 为固定空对象。独立验证日志前缀 ai-list-。系统配置继续遵循已确认方案，项目整体未完成；设备/真实供应商、全局工作台和 AI 运维/审计仍待完成。

2026-10-31 AI 对话阶段最终验证：三仓独立冻结安装通过；Backend lint/typecheck、119 文件/873 单测、3 文件/88 HTTP、30 文件/690 真实数据库测试、build/OpenAPI 与前后 db:verify（20 迁移）通过；Web 完整 check 684 项及官网/Admin build；App 完整 check 20 文件/247 项（AI 专项 3 文件/70 项）、lint 零警告、Doctor 20/20 与三平台 export 通过。三仓 OpenAPI 1.44.0 哈希一致，118 份 Markdown 的 660 个本地链接有效。测试后仅原管理员，动态/评论/操作日志为 0，四项账号管理权限均 active；原 pending Outbox、验证容器和开发进程保留。日志与最终导出保留，未提交、推送或部署。真实设备/浏览器/API 成功工作流、真实模型/Embedding、全局工作台、RAG 运维/AI 审计及整体验收仍未完成。

2026-10-31 App AI 对话配套复验：客户端完善取消、重试、确认回答与历史核对；本仓 AI/RAG 生产代码、数据库和 OpenAPI 1.44.0 保持不变。仍由后端裁决当前授权、会话所有权、5 条/分钟限流、请求幂等、租约 fencing 与保存后 completed。复验日志前缀 ai-workflow-。真实供应商、Guard 通过后的在途撤权、来源历史策略、RAG 运维和 AI 审计仍待完成；项目整体未完成，下文为历史阶段记录。

本阶段最终验证：Backend 119 文件/873 单测、3 文件/88 HTTP、30 文件/690 真实数据库测试、build/OpenAPI 及前后 db:verify（20 迁移）通过；Web 完整 check 684 项（账号专项 5 文件/113 项）、官网/Admin build；App check 183 项、Doctor 20/20 与三平台 export 通过。三仓独立冻结安装通过，OpenAPI 1.44.0 哈希一致。117 份 Markdown 的 648 个本地链接有效。测试后仅原管理员、动态/评论/操作日志为 0，四项账号管理权限均恢复 active，原 pending Outbox、验证库与开发进程保留。日志与导出产物保留，未提交、推送或部署。浏览器/API 成功流程及整体验收仍未完成。

2026-10-31 账号页面配套复验：Web ADM-05/06 完善目录分页、最新目标、提交门禁与未知结果核对；本仓生产代码和数据库保持不变，API-M02 仍依据事务内授权、user 范围与最后管理员保护裁决。OpenAPI 1.44.0，无新依赖或迁移，项目整体未完成。

本阶段独立冻结安装、lint/typecheck、119 文件/873 单测、3 文件/88 HTTP 及 build/OpenAPI 已通过，真实数据库结果见本阶段最终记录。三仓契约哈希一致；保留 user-console-*.log、原验证库和开发进程，未提交、推送或部署。管理员重置既有账号密码、全局工作台、RAG 运维/AI 审计及浏览器/设备/真实供应商验收仍有缺口；下文为历史阶段记录。

2026-10-31 账号事务授权阶段：账号创建、角色全量替换与启停在 Serializable 事务内复核有效主体、管理入口、动作和最新 user 范围；授予 system_admin 核实受保护身份，最后管理员锁与原子审计保留。修复目标 ID 被 self/selected 范围覆盖的问题，详情及写入统一以 AND 交集匹配。正 int4 编号与分页边界校验已补。OpenAPI 仍为 1.44.0，无新依赖或迁移，项目整体未完成。 见 [账号事务授权与边界](../user-write-authorization.md)。

本阶段最终验证：三仓独立冻结安装通过；Backend lint/typecheck、119 文件/873 单测、3 文件/88 HTTP、30 文件/690 真实数据库测试、build/OpenAPI 导出及前后 db:verify（20 迁移）通过。新账号数据库专项 51 项与认证会话 12 项合计 63 项通过；Web 完整 check 579 项及官网/Admin build；App check 183 项、Doctor 20/20 与三平台 export 通过。三仓 OpenAPI 哈希一致。初轮完整数据库 682/688 通过、6 项失败已修正，失败及最终日志保留。测试后仅原管理员、动态/评论/日志为 0，权限已恢复，原 Outbox、验证库和开发进程保留；未提交、推送或部署。账号 UI、全局工作台、RAG 运维/AI 审计、浏览器/设备/真实供应商仍有缺口；下文按历史阶段阅读。

账号创建、角色全量替换与账号启停已改为在写事务内复核有效身份、动作和最新 user 范围；写入端口不接收请求层管理员标记或范围快照。实现与时间边界见 [账号写事务授权](../user-write-authorization.md)。

2026-10-31 角色页面配套复验：本仓业务代码、schema 和 OpenAPI 1.44.0 不变；角色授权仍由 [角色写事务规则](../role-write-authorization.md) 裁决。系统配置维持已确认协议，项目整体未完成。

本阶段最终验证：三仓独立冻结安装通过；Backend lint/typecheck、118 文件/855 单测、3 文件/88 HTTP、29 文件/639 真实数据库测试、build/OpenAPI 导出与前后 db:verify（20 迁移）通过。Web 完整 check 579 项（角色专项 6 文件/106 项）及官网/Admin build 通过，构建包含角色详情路由；App check 183 项、Doctor 20/20 与三平台 export 通过。三仓契约哈希一致。测试后仅原管理员，动态/评论/操作日志为 0，原待处理 Outbox、开发进程和验证库保留；日志与导出产物保留，未提交/推送/部署。首轮参数化测试夹具、null 类型及 React Key 类型适配问题已修正，失败日志保留。浏览器/设备/真实供应商、全局工作台与 AI 运维/审计等仍待完成，下文按历史阶段阅读。

2026-10-31 角色事务授权阶段：角色创建、修改、停用及授权快照替换在 Serializable 事务内重读有效身份、管理入口、动作权限和 role 范围；创建要求 all，修改/停用要求 all 或 selected 含目标。管理员专属范围配置和快照替换另核实受保护身份。撤权拒绝不写角色、授权集合或成功审计；授权依据为写事务快照，不保证取消快照建立后的全部撤权。OpenAPI 保持 1.44.0，无新依赖或迁移，项目整体未完成。 见 [角色事务授权](../role-write-authorization.md)。

本阶段验证：三仓独立冻结安装通过；Backend lint/typecheck、118 文件/855 单测、3 文件/88 HTTP 与 build/OpenAPI 导出通过，三组角色真实数据库专项 3 文件/65 项通过。Web 完整 check 488 项及官网/Admin build；App check 183 项、Doctor 20/20 和三平台 export 通过。最终完整数据库 29 文件/639 项通过，测试前后 db:verify 通过（20 迁移）；三仓 OpenAPI 1.44.0 哈希一致。114 份 Markdown 的 614 个本地链接有效。首轮旧错误断言和无授权夹具三项失败，以及夹具角色键超长初始化失败均已修正，保留失败与复验日志。原开发进程及验证库保留；未提交/推送/部署。浏览器、设备、真实供应商、全局工作台和 AI 运维/审计仍有缺口，下文为历史阶段记录。

2026-10-31 权限目录页面配套复验：Web 已补齐目录读取、编辑与写入核对工作流；后端生产代码、数据库和接口协议保持不变，系统配置继续按已确认方案提供管理员 GET/PATCH 与公开 GET。当前 OpenAPI 1.44.0，无新增依赖或迁移；项目整体未完成。

本阶段最终验证：三仓独立冻结安装通过；本仓 lint/typecheck、118 文件/853 单测、3 文件/88 HTTP、28 文件/598 真实数据库测试及 build 通过，前后 db:verify 通过（20 迁移）。Web check 488 项及官网/Admin build，App check 183 项、Doctor 20/20 与三平台 export 通过。三仓 OpenAPI 哈希一致；保留 permission-console-*.log。验证库仅剩原管理员，动态/评论/操作日志为 0，既有待处理 Outbox 和原开发进程保留。浏览器、设备、真实供应商及整体验收仍缺；未提交、推送或部署。下文为历史阶段记录。

2026-10-31 字典与权限目录事务授权阶段：字典六类写命令、权限目录三类写命令与注册表同步均在 Serializable 事务内复核有效身份、管理入口和动作授权；同步另需受保护 system_admin 身份。自定义角色保持按授权管理，拒绝不留下配置、审计或字典 Outbox。OpenAPI 仍为 1.44.0，无新依赖或迁移；项目整体未完成。 见 [配置写入授权](../configuration-write-authorization.md)。

本阶段验证：三仓独立冻结安装通过；Backend lint/typecheck、118 文件/853 单测、3 文件/88 HTTP、28 文件/598 真实数据库测试及 build 通过，测试前后 db:verify 通过（20 迁移）。新增事务授权 32 项，与原字典/权限目录套件合计 104 项通过；初轮一次夹具事务超时已记录，复验与全量通过。Web 完整 check 422 项及官网/Admin build；App check 183 项、Doctor 20/20 与三平台 export 通过。客户端业务和契约不变，测试夹具无残留，原管理员、待处理 Outbox 和开发进程保留；未提交、推送或部署。浏览器/设备、真实供应商与整体验收仍待完成。

2026-10-31 字段写入授权阶段：七类字段/分组命令已在 Serializable 事务内重读有效身份、管理入口与动作授权，公开字段启用复核受保护管理员身份。自定义角色仍按授权工作。实现、撤权测试和并发边界见 [字段事务授权](../custom-field-write-authorization.md)。OpenAPI 仍为 1.44.0，项目整体未完成。

本阶段验证：三仓独立冻结安装通过；Backend lint/typecheck、118 文件/852 单测、3 文件/88 HTTP、27 文件/566 真实数据库测试及 build 通过，测试前后 db:verify 通过（20 迁移）；Web 完整 check 422 项及官网/Admin build；App check 183 项、Doctor 20/20 和 iOS/Android/Web export 通过。字段配置与事务授权专项合计 50 项。客户端业务与契约未变化；真实浏览器、设备、供应商及整体验收仍待完成。

2026-10-31 字段实体路由阶段：补齐/admin/system/fields/[entityType]，四类实体URL校验、列表/返回/切换导航和直达权限已接，复用字段/分组表单与写门禁。字段专项73项及三仓完整回归通过。OpenAPI保持1.44.0，无新依赖或迁移；项目整体未完成。下文按历史阶段阅读。 [OpenAPI](../../../contracts/openapi.json)

字段实体路由阶段最终验证：三仓独立冻结安装通过；Backend lint/typecheck、118文件/851单测、3文件/88 HTTP、26文件/542真实数据库测试与build通过，前后db:verify通过（20迁移）。Web完整check422项及官网/Admin构建通过，构建产物包含/admin/system/fields/[entityType]；App check183项、Doctor20/20和三平台导出通过。103份Markdown、552个本地链接有效。OpenAPI1.44.0快照及生成类型不变；原开发服务、验证库、管理员与待处理Outbox保留，未提交/推送/部署。真实浏览器、设备、供应商与项目整体验收仍缺。

2026-10-31 字段配置页阶段：分离字段/分组/详情请求与失败状态，账号/实体切换隔离旧回调；编辑前读取最新详情，提交前同步锁与身份核对，支持显式null清除和结果不明后的刷新核对。修正字段DTO的Swagger类型，三仓同步OpenAPI1.44.0，无新依赖或迁移。字段专项49项与三仓完整回归已通过；项目整体未完成，下文按历史阶段阅读。 [字段契约工程说明](../custom-field-contract-types.md)

字段配置页阶段最终验证：三仓独立冻结安装通过；Backend lint/typecheck、118文件/851单测、3文件/88 HTTP、26文件/542真实数据库测试及build通过，前后db:verify通过（20迁移，字段配置专项26项）。Web完整check398项（字段专项49项、字典专项68项）与官网/Admin构建通过；App check183项、Doctor20/20和三平台导出通过。三仓OpenAPI1.44.0 SHA-256均为 `98baf03cc01588729adc9581fce4980a7eca8855b91e03fc37a9aa8a51d99cc2`。无新依赖或迁移；原开发服务、验证库、管理员及待处理Outbox保留，测试夹具无残留，未提交/推送/部署。浏览器/设备/真实供应商和全项目验收仍未完成。

2026-10-31 字段组详情阶段：补齐既有契约 GET /admin/custom-field-groups/:entityType/:groupKey；沿用管理入口与 system:field-group:list，复合键查询、停用可读、非法参数400、缺失404，读取不写审计或Outbox。OpenAPI1.43.0，三仓同步快照与生成类型，无新依赖或迁移。本阶段验证已通过；下文旧版本与测试数按历史阶段阅读。 [字段组详情工程说明](../custom-field-group-detail.md)

本阶段最终验证：三仓独立冻结安装通过；Backend lint/typecheck、118文件/851单测、3文件/88 HTTP、26文件/539真实数据库测试、build/OpenAPI及前后db:verify通过（20迁移）；字段配置专项现为23项。Web完整check349项及官网/Admin构建通过；App check183项、Doctor20/20和iOS/Android/Web导出通过。三仓OpenAPI1.43.0哈希一致，无新依赖或迁移。测试夹具已清理，原管理员、既有待处理Outbox和开发服务保留，未提交、推送或部署。

2026-10-31 字典独立详情路由阶段：ADM-10 的 /admin/system/dictionaries/[dictType] 已实现，列表链接与返回入口接通；共用表单与写门禁，支持类型资料与多层级项维护。类型键校验、单次解码、直达权限与URL切换实例隔离已接，字典专项68项通过。Backend/App业务和OpenAPI1.42.0不变，无新依赖或迁移。真实浏览器/设备/供应商、全局工作台、AI运维/审计及待定版协议仍有缺口，项目整体未完成。下文旧阶段按历史阅读。

独立字典详情阶段最终验证：三仓独立冻结安装通过；Backend lint/typecheck、118文件/843单测、3文件/88 HTTP、26文件/527真实数据库测试、build及前后db:verify通过（20迁移）；Web完整check349项、窄屏换行调整后68项字典专项与官网/Admin构建通过，构建明确包含独立动态路由；App check183项、Doctor20/20和三平台导出通过。99份Markdown、529个本地链接有效，三仓OpenAPI1.42.0哈希仍为 `9be7657a9dd581d3f0aa2649b4a2d32e156acf2379d63842619ebf52679788c2`。原开发进程和验证库、日志与导出产物保留，未提交/推送/部署。以上不证明登录后浏览器点击、窄屏实测、真实设备或供应商验收；字段组单条GET、全局工作台和AI运维/审计等仍待完成。

2026-10-31 管理端字典稳定性阶段：修复选中字典后的持续请求、迟到响应覆盖、树表重复节点和清空父级未提交 null；父级候选排除整棵子树，账号/权限快照隔离、校验前写锁、提交前身份核对及不确定结果刷新核对已接。新增42项模型/竞争/SSR测试已通过，补齐原契约遗漏的字典项GET详情及int4边界；OpenAPI更新到1.42.0，无新依赖或迁移。详见 [字典项详情工程说明](../dictionary-item-detail.md)。系统配置保持已确认方案。公开标签目录、全局雪场字段/资产授权及RAG运维仍待定版；全局工作台、AI会话审计、真实浏览器/设备/供应商验收仍缺，项目整体未完成。下文旧阶段记录按历史阅读。

字典阶段最终验证：三仓独立冻结安装通过；Backend lint/typecheck、118文件/843单测、3文件/88 HTTP、26文件/527真实数据库测试及build/OpenAPI导出通过，前后db:verify通过（20迁移）；Web完整check322项（含新增字典42项）及官网/Admin构建通过；App check183项、Doctor20/20和三平台导出通过。三仓OpenAPI1.42.0 SHA-256均为 `9be7657a9dd581d3f0aa2649b4a2d32e156acf2379d63842619ebf52679788c2`。初轮README/锁文件格式、Swagger参数声明及旧版本断言失败均已修正复验；日志与导出产物保留。原开发进程、既有管理员与待处理Outbox保留，无动态/评论/操作日志测试残留。未提交、推送或部署，登录后浏览器、设备和真实供应商验收仍未完成。

2026-10-31 社区阅读与操作核对阶段：官网信息流搜索/游标重试保留条件、后续空页返回、动态/雪场详情int4边界及独立评论分页恢复已补齐；App会话恢复门禁、个人读取核对、账号缓存隔离、同步写锁、删除确认和不确定结果显式核对已接，迟到回调不再更新其他账号点赞缓存。后端正文查询修复LIKE特殊字符的模式解释，真实社区专项51项通过。详见 [社区工程说明](../community-query-recovery.md)。OpenAPI仍1.41.0，无新依赖/迁移；评论未新增服务端幂等键，不宣称跨设备去重。公开标签目录、全局雪场字段/资产授权及RAG运维方案仍待确认；全局工作台、AI会话审计、设备/成功数据浏览器及真实供应商验收仍缺，项目整体未完成。下文按历史阶段阅读。

本阶段验证：三仓独立冻结安装通过；Backend lint/typecheck、118文件/833单测、3文件/87 HTTP、26文件/517真实数据库测试及build通过，前后db:verify通过（20迁移）；Web完整check 280项（新增22项社区页面/loader）及官网/Admin构建通过；App check 183项（新增35项社区逻辑/transport）、Doctor20/20及三平台导出通过。三仓OpenAPI1.41.0 SHA-256均为 `6708699df73b08b2dc97653abb886f5af2c3acc8b746430cd95ecc8357d13c6a`。特殊字符初始3项失败、测试hook误返回mock及列表header类型错误均已修正并复验。原3010浏览器验证非法游标恢复保留搜索；因原进程无API地址，成功数据态未验。未提交/推送/部署，保留原开发进程及验证库。

2026-10-31 公开知识目录阶段：官网文章/分类独立降级、非法筛选前置校验、分页/重试保留条件与后续空页返回已实现；App 分类清除、总数、保留列表的加载更多/刷新重试，以及账号/条件缓存和取消读取检查已补齐。后端修复 PostgreSQL 对关键词 %、_、反斜杠的模式解释，按字面内容匹配；真实 HTTP/PostgreSQL 知识专项从16项扩至31项。详见 [知识目录工程说明](../public-knowledge-directory.md)。OpenAPI 仍1.41.0，无新依赖/迁移。公开标签目录、全局雪场字段/资产授权及RAG运维方案仍待确认；全局工作台、AI会话审计、成功数据浏览器/原生设备及真实供应商验收仍缺，项目整体未完成。下文旧阶段按历史记录阅读。

本阶段验证：三仓独立冻结安装通过；Backend lint/typecheck、118文件/833单测、3文件/87 HTTP、26文件/514真实数据库测试及build通过，前后db:verify通过（20迁移）；Web完整check 258项及官网/Admin构建通过，提示区域对齐调整后专项15项和双应用构建再验通过；App check 148项、Doctor 20/20及三平台导出通过。三仓OpenAPI 1.41.0 SHA-256均为 `6708699df73b08b2dc97653abb886f5af2c3acc8b746430cd95ecc8357d13c6a`。初轮真实特殊字符测试3项失败及测试夹具类型检查失败已修正并复验；记录保留。未提交/推送/部署，原开发进程及验证库保留。

2026-10-31 公开雪场筛选阶段：官网与 App 接入地区/价格/评分/营业状态/成对坐标和完整排序，补齐分页、零距离及失败恢复；App 使用生成响应类型并隔离账号/条件缓存。后端修正分页 OpenAPI 类型和公开详情正 int4 边界，专项真实 HTTP/PostgreSQL 23 项通过。浏览器发现并修复缺少 API 地址时的整页崩溃，原 3010 进程已核对表单/校验/重试与窄屏；该进程无 API 地址，成功数据态仍待联调。OpenAPI 1.41.0，三仓同快照，无新依赖/migration；详见 [公开雪场工程说明](../global-public-resort-ddd.md)。公开标签目录待定版，完整标签多选 UI 尚未交付；全局工作台、AI 运维/审计、真实供应商/设备等仍缺，项目整体未完成。下文旧数字为历史阶段。

公开雪场筛选阶段最终验证：三仓独立冻结安装通过；Backend lint/typecheck、118 文件/833 单测、3 文件/87 HTTP、26 文件/499 真实数据库测试与 build 通过，测试前后 db:verify 均通过（20 迁移）。Web 完整 check 243 项及官网/Admin build 通过；App 完整 check 127 项、Doctor 20/20 与 iOS/Android/Web export 通过（包括筛选重置缓存后的复验）。三仓 OpenAPI 1.41.0 的 SHA-256 均为 `6708699df73b08b2dc97653abb886f5af2c3acc8b746430cd95ecc8357d13c6a`。没有新依赖或迁移；保留原开发进程及验证库，未提交、推送或部署。成功数据态浏览器、原生设备及真实存储/模型联调仍未完成。

2026-10-31 商家工作台阶段：ADM-02 页面已接入现有雪场/收益查询、筛选与状态展示；权限按入口和各数据 API 分别检查，商家身份仍由后端解析。OpenAPI 1.40.0 补齐既有 MerchantResortVO/PageVO，三仓同步生成类型，无新增依赖或迁移。已有非管理员角色不会因重复 seed 自动获得新 grants，须由系统管理员显式授权。系统配置确认方案已实现并进入本阶段回归；工程细节及验收边界见 [商家工作台](../../../../web/docs/engineering/merchant-dashboard.md)。全局工作台 API-M01、AI 运维/会话审计、浏览器/设备与真实供应商等仍未完成，项目整体未完成。下文旧版本/数字为历史阶段记录。

本阶段最终验证：三仓各自冻结安装通过；Backend lint/typecheck、118 文件/827 单测、3 文件/86 HTTP、26 文件/481 真实数据库测试和 build 通过，测试前后 db:verify 均通过（20 迁移）；Web 完整 check 213 项（含新增工作台25项和路由1项）及官网/Admin build 通过；App check 99 项、Doctor 20/20 和三平台 export 通过。三仓 OpenAPI 1.40.0 的 SHA-256 均为 `2f7a4a6da000f866644bae7406c48b9e59c7af43201eb8894320488666c8be50`。系统配置领域/应用、真实 HTTP/数据库和三端展示专项已随全套回归通过。未提交/推送/部署，原有开发进程和验证库保持运行。

2026-10-30 历史知识复验阶段：项目知识 RAG 入口复用既有发布校验，违规旧内容不调用 Embedding；项目知识 sourceState 升级 v2，旧 v1 在复验回填前隐藏。其他来源与 OpenAPI 1.39.0 不变，无新增依赖或迁移。见 [历史知识复验](../rag-legacy-project-validation.md)。人工全量语料审查、真实 provider 回填和项目整体验收仍未完成；下方旧阶段按历史阅读。

2026-10-30 RAG 字段分组阶段：修复文章分组停用后公开字段仍进入索引及检索的问题；读取与 SQL 均按活动分组过滤，真实 pgvector 覆盖停用/重建/恢复、无值不误隐藏及 LIMIT 前过滤。OpenAPI 仍 1.39.0，无新增协议、依赖或迁移。见 [字段分组验收](../rag-field-group-validation.md)。历史知识语料审查、AI 运维及整体验收仍未完成；下方数字按历史阶段阅读。

2026-10-30 知识写入授权阶段：项目知识五类写命令已在事务内复核受保护管理员、入口/动作权限，补齐敏感元数据/来源 URL、发布前存量校验和 ID/版本边界；文章封面/分类增加共享锁、MIME 与 raw 冲突映射。新增 31 项真实数据库测试，知识专项共 50 项通过。三仓冻结安装通过；Backend lint/typecheck、118 文件/816 单测、3 文件/85 HTTP、26 文件/468 真实数据库测试、build 及前后 db:verify（20 迁移）通过；Web check 187 项及官网/Admin production build；App check 99 项、Doctor 20/20 和三平台 export 通过。OpenAPI 仍 1.39.0，三仓哈希一致，无新依赖或 migration。见 [知识写入验收](../knowledge-write-validation.md)。全局雪场字段/资源授权、RAG 运维、工作台/会话审计与浏览器/设备/真实供应商等仍未完成，项目整体未完成。

2026-10-30 系统配置阶段：用户已确认六项文本配置协议，后端管理员 GET/PATCH 与公开 GET /public/config、expectedVersion、事务内授权/审计已实现；Web 配置页与官网/App 关于/隐私/协议页面已接入。三仓独立冻结安装通过；Backend lint/typecheck、117 文件/772 单测、3 文件/85 HTTP、23 文件/372 真实数据库测试、build/OpenAPI 通过，测试前后 db:verify 通过（20 迁移）；Web check 187 项及官网/Admin production build；App check 99 项、Doctor 20/20 和三平台 export 通过。OpenAPI 1.39.0，三仓 SHA-256 均为 `bd9f3a624ab2263966bc4e9b6a33bd677e735af94f27ff44b446b2ba5a9e9444`；无新依赖或 migration。 见 [系统配置工程说明](../system-config.md)。正式政策内容、浏览器/设备、真实供应商与 AI 管理等仍待完成，项目整体未完成；下方旧阶段记录按历史阅读。

2026-10-30 AI 联合验收阶段：修复会话分页偏移与消息运行时类型校验；新增真实登录/HTTP/SSE/pgvector 测试 22 项，含引用过滤、幂等重放、失败重试、断流取消、删除竞争和跨会话限流。三仓独立冻结安装通过；Backend lint/typecheck、115 文件/751 单测、3 文件/84 HTTP、22 文件/351 真实数据库测试、build/OpenAPI 通过，测试前后 db:verify 均通过（20 迁移）；Web check 175 项及官网/Admin production build；App check 96 项、Doctor 20/20、iOS/Android/Web export 通过。OpenAPI 仍 1.38.0，三仓 SHA-256 均为 `675969590facea86c8228c2e89fc8a69ee0329f893ab0e4314ad8c1fe6fcbc6e`；无新依赖或迁移。 详见 [AI 联合验收](../ai-http-rag-validation.md)。真实模型/provider/设备、在途撤权与来源变化、系统配置及 AI 管理仍待完成，项目整体未完成。下文其他阶段数字按历史记录阅读。

本阶段最终验证（社区事务授权）：三仓独立 frozen install 通过；Backend lint/typecheck、115 文件/734 单测、3 文件/84 HTTP、21 文件/329 真实数据库测试、build/OpenAPI 通过，测试前后 db:verify 均通过（20 迁移）。Web 完整 check 175 项及官网/Admin production build；App check 96 项、Doctor 20/20、iOS/Android/Web export 均通过。无新依赖或 migration，OpenAPI 仍 1.38.0、三仓 SHA-256 均为 `675969590facea86c8228c2e89fc8a69ee0329f893ab0e4314ad8c1fe6fcbc6e`。未提交或推送，原 3010/3001 开发进程保持不变。

2026-10-30 社区事务阶段：11 种写命令已复核事务内有效账号/角色/权限及冲突范围；图片/雪场引用增加 FOR SHARE、raw 序列化冲突有限重试。社区专项 123 单测、53 真实数据库测试通过，详见 [事务内授权与引用并发](../community-transaction-authorization.md)。契约仍 1.38.0，无新增依赖/migration；授权快照后的即时撤权、全域权限协议和真实浏览器/设备等仍未完成。下方统计按各历史阶段阅读。

本阶段最终验证：三仓独立冻结安装通过；Backend lint/typecheck、114 文件/704 单测、3 文件/84 HTTP 测试、21 文件/317 真实数据库测试（新增社区 HTTP/PostgreSQL 36 项）、build/OpenAPI 通过。Web 完整 check 175 项及官网/Admin production build 通过；App check 96 项、Doctor 20/20、iOS/Android/Web export 通过（Doctor 提示远程 native modules 清单获取警告）。数据库测试前后 db:verify 通过，仍为 20 迁移；无新增依赖或迁移。OpenAPI 1.38.0 三仓 SHA-256 均为 `675969590facea86c8228c2e89fc8a69ee0329f893ab0e4314ad8c1fe6fcbc6e`。

2026-10-30 社区输入/图片隔离阶段：正 int4、分页/游标、空 PATCH/null 校验、公开图片 owner/ready/MIME 复核及点赞读取快照已实现。用户已确认统一最多 9 张图片，创建/编辑 DTO 与领域校验已同步。当前 OpenAPI 1.38.0；实施与验收边界见 [社区验收](../community-validation.md)。下文旧版本和测试统计为历史阶段记录。项目整体仍未完成。

2026-10-30 D-36：公开文章列表/详情增加 favoriteByMe；游客 false，本人关系投影、私有 no-store、int4 ID 和公开性保护已完成。当前 OpenAPI 1.37.0。见 [文章收藏工程说明](../article-favorite-state.md)。

本阶段 Backend：114 文件/682 单测、3 文件/84 HTTP 测试、20 文件/281 真实数据库测试（D-36 为 16 项）、lint/typecheck、build/OpenAPI 通过；Web：完整 check 175 项、官网/Admin production build 通过；App：完整 check 96 项、Doctor 20/20，最终 lint/typecheck/test 复验及 iOS/Android/Web export 通过。验证库保持 20 迁移，完整数据库测试前后 db:verify 通过。无新增依赖或迁移，未提交或推送。

以下为历史阶段记录；当前验证状态以上述 D-36 结果为准。

2026-10-30 D-30：本人资料编辑、头像资产兼容/签名/删除保护与 OpenAPI 1.36.0 已实现；本阶段验证结果见 [本人资料工程说明](../own-profile.md)。

三仓冻结安装通过；本仓 lint/typecheck、680 单测、84 HTTP、265 真实数据库测试（资料 29 项）及 build/OpenAPI 通过。验证库 20 迁移、两次 seed、前后校验及重复 deploy 通过；旧库增量升级，无生产库操作。

历史阶段：2026-10-30 D-05：Outbox元数据列表与failed→pending重试、事务内授权/审计、管理端筛选分页及重试原因表单已实现。Backend check112文件/656项、HTTP83项、真实数据库18文件/236项（事件24项）及build/OpenAPI通过；Web check164项/官网与Admin build通过；App check64项/Doctor20/20/三平台export通过。三仓冻结安装及OpenAPI1.35.0快照/生成类型一致；无新依赖或migration。浏览器/设备、系统配置/AI管理、全域授权、真实存储/provider与全项目验收仍缺。 详见 [Outbox运维说明](../outbox-management.md)。部署后运行seed同步新增事件权限。

历史阶段：2026-10-29 收益阶段：新增23项真实HTTP/PostgreSQL验收，补输入边界、日期与Serializable审计一致性/409，修正note的Swagger类型。独立冻结安装、check647项、HTTP83项、数据库212项与build/OpenAPI通过。当前契约1.34.0；见 [收益验收](../revenue-validation.md)。其他系统管理接口、全域授权、外部服务与项目整体验收仍缺。

历史阶段：2026-10-29 D-23：新增授权资源目录与事务内未知键兼容校验，修复角色 PATCH null/空输入。冻结安装、check646项、HTTP83项、完整数据库189项与build/OpenAPI通过；当前契约1.33.0。协议、代码与真实数据库边界见 [授权资源目录验收](../authorization-resource-catalog.md)。全域授权与项目整体验收仍未完成。

历史阶段：2026-10-29 权限目录验收：新增节点及子树详情，修复部分更新、空值、重复写入、审计信息超限和同步冲突。独立冻结安装、check639项、HTTP81项、真实DB168项（权限目录29项）与build/OpenAPI通过。当前契约1.32.0；实现、复验方式与边界见 [权限目录验收](../permission-catalog-validation.md)。

历史阶段：2026-10-29 字典验收：修复null校验、审计请求信息超限、动态字段字典引用及父级变更的后代RAG事件。独立冻结安装、check639项、HTTP80项、真实数据库139项（字典33项）、build/OpenAPI通过。当前契约1.31.0；实施与边界见 [字典管理验收](../dictionary-validation.md)。

历史阶段：2026-10-29 字段审计：字段/分组全部写入已补齐同事务审计、版本冲突与回滚。独立冻结安装、check639项、HTTP80项、真实数据库106项及build/OpenAPI通过。无新HTTP协议/依赖/migration，当前OpenAPI1.31.0。实现与验证边界见 [字段原子审计](../custom-field-audit.md)。

历史D-42验收：独立冻结安装、check 638 项、HTTP 80 项、build/OpenAPI 及真实数据库95项通过，日志HTTP数据库17项。独立空库19迁移、两次seed和测试前后结构校验通过；临时容器已核对身份后自动移除，原有服务未改动。

D-42 操作日志只读查询已实现，使用当前 OpenAPI 1.31.0；契约/DDD/敏感列排除及真实数据库验收见 [日志查询说明](../operation-log-query.md)。配置、Outbox运维与全域写审计覆盖仍需完成。

2026-10-29 D-41 已实施：资产管理按 all/self/selected 过滤，merchant 与冲突拒绝，范围外详情/删除 404。Backend check 628 项、HTTP 79 项、真实数据库 78 项（资产 12 项）、build/OpenAPI 通过。OpenAPI 1.30.0 已同步三端。细节、测试边界和独立复验见 [资产范围说明](../global-asset-scope.md)。

历史阶段：2026-10-29 资产与扫描阶段复验：修复扫描器提前关闭时未结束请求、宽松响应判断及资产整数溢出问题。新增 13 项快速回归、9 项真实 HTTP/PostgreSQL 资产测试及 5 项实际 ClamAV 测试。Backend check 109 文件/624 项、HTTP 79 项、build/OpenAPI；完整真实数据库 11 文件/75 项；Web check 102 项与双应用 build；App 完整 check 64 项、Doctor 20/20 和三平台 export 最终均通过。三仓冻结安装通过，OpenAPI 1.29.0 哈希一致。MinIO 来源拉取被拒/官方归档 410，真实对象存储尚未验证；数据库测试仅替换外部扫描/存储，真实 ClamAV 套件仍替换存储。项目整体未完成。 见 [资产与扫描验收](../asset-validation.md)。

历史阶段：2026-10-29 Kafka 集成阶段：修复新消费者组从末尾开始读取而遗漏已发布积压事件的问题，改为最早保留位置起读，已有组按已提交 offset 恢复。真实 Kafka 4.1.1 + PostgreSQL/pgvector 集成 6 项通过，覆盖五类来源、重复投递、失败重连、Outbox 租约及停机恢复；Embedding 为固定向量替身。三仓冻结安装通过；Backend check 109 文件/611 项、HTTP 79 项、build/OpenAPI；真实数据库 10 文件/66 项；Web check 102 项及双应用 build；App check 64 项、Doctor 20/20 和三平台 export 均通过。无新增 API/schema/migration/依赖，OpenAPI 保持 1.29.0。项目整体未完成。 见 [真实 Kafka/RAG 集成](../kafka-rag-integration.md)；独立命令 pnpm test:integration 要求专用 DATABASE_URL 和 KAFKA_INTEGRATION_BROKERS，不能对开发/生产库执行。

历史阶段：2026-10-29 图片库与资产授权复验：三仓独立 frozen install 通过；Backend check 109 文件/611 项、HTTP 3 文件/79 项、build/OpenAPI 通过；Web check 102 项及官网/Admin production build 通过；App check 9 文件/64 项、Expo Doctor 20/20 与 iOS/Android/Web export 通过。Doctor 本轮恢复，上阶段网络超时保留为历史。本轮未改持久化、未重跑数据库套件；真实 PostgreSQL/pgvector 10 文件/66 项为上阶段已通过证据。OpenAPI 仍为 1.29.0，三仓 SHA-256 一致。项目整体未完成。 见 [全局资产范围](../global-asset-scope.md)、[认证与并发验收](../identity-session-validation.md)、[文章字段授权](../article-field-authorization.md)与 [数据库验收](../database-validation.md)。

凛迹雪客的独立后端仓库，为官网、管理端和 Expo App 提供版本化 `/api/v1` HTTP API。
Backend 使用 NestJS + TypeScript 的 DDD 模块化单体，独占 PostgreSQL/pgvector、Kafka
和对话模型、Embedding 模型的接入。

本目录可以独立克隆、安装、开发、测试、迁移和部署，不依赖 Web、App 或项目父目录。所有
客户端只能通过 API 访问业务数据，不能直连数据库、Kafka、pgvector 或模型供应商。
