# 本地 PostgreSQL / pgvector 验收

2026-11-04 全业务数据库续验：当前源码36文件859项完整数据库测试、24迁移/双seed/前后校验通过，专用集群已停止；新结果见[回归说明](full-database-regression.md)，下文旧日期/计数保留当时事实。

2026-11-02 AI 管理阶段：新建隔离库已应用23项迁移、两次seed并通过结构校验；新增会话审计11项与RAG控制14项真实数据库专项通过，含HTTP授权、审计失败回滚、同版本竞争、索引代次隔离与Inbox去重。修复RAG原始SQL冲突漏映射409，完整结果见[AI管理数据库验收](ai-operations-database-validation.md)。后续旧日期和Docker故障记录按历史阅读。

2026-10-30 历史知识复验阶段：项目知识 RAG 入口复用既有发布校验，违规旧内容不调用 Embedding；项目知识 sourceState 升级 v2，旧 v1 在复验回填前隐藏。其他来源与 OpenAPI 1.39.0 不变，无新增依赖或迁移。见 [历史知识复验](rag-legacy-project-validation.md)。人工全量语料审查、真实 provider 回填和项目整体验收仍未完成；下方旧阶段按历史阅读。

2026-10-30 RAG 字段分组阶段：修复文章分组停用后公开字段仍进入索引及检索的问题；读取与 SQL 均按活动分组过滤，真实 pgvector 覆盖停用/重建/恢复、无值不误隐藏及 LIMIT 前过滤。OpenAPI 仍 1.39.0，无新增协议、依赖或迁移。见 [字段分组验收](rag-field-group-validation.md)。历史知识语料审查、AI 运维及整体验收仍未完成；下方数字按历史阶段阅读。

2026-10-30 知识写入授权阶段：项目知识五类写命令已在事务内复核受保护管理员、入口/动作权限，补齐敏感元数据/来源 URL、发布前存量校验和 ID/版本边界；文章封面/分类增加共享锁、MIME 与 raw 冲突映射。新增 31 项真实数据库测试，知识专项共 50 项通过。三仓冻结安装通过；Backend lint/typecheck、118 文件/816 单测、3 文件/85 HTTP、26 文件/468 真实数据库测试、build 及前后 db:verify（20 迁移）通过；Web check 187 项及官网/Admin production build；App check 99 项、Doctor 20/20 和三平台 export 通过。OpenAPI 仍 1.39.0，三仓哈希一致，无新依赖或 migration。见 [知识写入验收](knowledge-write-validation.md)。全局雪场字段/资源授权、RAG 运维、工作台/会话审计与浏览器/设备/真实供应商等仍未完成，项目整体未完成。

2026-10-30 系统配置阶段：用户已确认六项文本配置协议，后端管理员 GET/PATCH 与公开 GET /public/config、expectedVersion、事务内授权/审计已实现；Web 配置页与官网/App 关于/隐私/协议页面已接入。三仓独立冻结安装通过；Backend lint/typecheck、117 文件/772 单测、3 文件/85 HTTP、23 文件/372 真实数据库测试、build/OpenAPI 通过，测试前后 db:verify 通过（20 迁移）；Web check 187 项及官网/Admin production build；App check 99 项、Doctor 20/20 和三平台 export 通过。OpenAPI 1.39.0，三仓 SHA-256 均为 `bd9f3a624ab2263966bc4e9b6a33bd677e735af94f27ff44b446b2ba5a9e9444`；无新依赖或 migration。 见 [系统配置工程说明](system-config.md)。正式政策内容、浏览器/设备、真实供应商与 AI 管理等仍待完成，项目整体未完成；下方旧阶段记录按历史阅读。

2026-10-30 AI 联合验收阶段：修复会话分页偏移与消息运行时类型校验；新增真实登录/HTTP/SSE/pgvector 测试 22 项，含引用过滤、幂等重放、失败重试、断流取消、删除竞争和跨会话限流。三仓独立冻结安装通过；Backend lint/typecheck、115 文件/751 单测、3 文件/84 HTTP、22 文件/351 真实数据库测试、build/OpenAPI 通过，测试前后 db:verify 均通过（20 迁移）；Web check 175 项及官网/Admin production build；App check 96 项、Doctor 20/20、iOS/Android/Web export 通过。OpenAPI 仍 1.38.0，三仓 SHA-256 均为 `675969590facea86c8228c2e89fc8a69ee0329f893ab0e4314ad8c1fe6fcbc6e`；无新依赖或迁移。 详见 [AI 联合验收](ai-http-rag-validation.md)。真实模型/provider/设备、在途撤权与来源变化、系统配置及 AI 管理仍待完成，项目整体未完成。下文其他阶段数字按历史记录阅读。

本阶段最终验证（社区事务授权）：三仓独立 frozen install 通过；Backend lint/typecheck、115 文件/734 单测、3 文件/84 HTTP、21 文件/329 真实数据库测试、build/OpenAPI 通过，测试前后 db:verify 均通过（20 迁移）。Web 完整 check 175 项及官网/Admin production build；App check 96 项、Doctor 20/20、iOS/Android/Web export 均通过。无新依赖或 migration，OpenAPI 仍 1.38.0、三仓 SHA-256 均为 `675969590facea86c8228c2e89fc8a69ee0329f893ab0e4314ad8c1fe6fcbc6e`。未提交或推送，原 3010/3001 开发进程保持不变。

本阶段最终验证：三仓独立冻结安装通过；Backend lint/typecheck、114 文件/704 单测、3 文件/84 HTTP 测试、21 文件/317 真实数据库测试（新增社区 HTTP/PostgreSQL 36 项）、build/OpenAPI 通过。Web 完整 check 175 项及官网/Admin production build 通过；App check 96 项、Doctor 20/20、iOS/Android/Web export 通过（Doctor 提示远程 native modules 清单获取警告）。数据库测试前后 db:verify 通过，仍为 20 迁移；无新增依赖或迁移。OpenAPI 1.38.0 三仓 SHA-256 均为 `675969590facea86c8228c2e89fc8a69ee0329f893ab0e4314ad8c1fe6fcbc6e`。

2026-10-30 D-36：复用已迁移的专用库，无新 migration；完整 20 文件/281 数据库测试及前后 db:verify 通过，新增文章收藏 HTTP/PostgreSQL 16 项。使用验证容器 linji-events-validation-20261030 的独立库，未改生产数据库。存储替身与浏览器验收边界见 [文章收藏状态](article-favorite-state.md)。以下记录中的旧数据库测试数属于对应历史阶段。

2026-10-30 D-30：已有专用验证库升级至 20 迁移，新增 User.AvatarAssetId 的索引与 RESTRICT 外键；此阶段属于增量升级，未重新宣称空库冷启动。资料 HTTP/DB、审计回滚与真实行锁竞争见 [本人资料](own-profile.md)。

## 权限目录当前复验（2026-10-29）

专用空库19迁移、两次seed、测试前后结构校验与重复deploy无pending通过。完整数据库15文件/168项，两次全量复验通过；权限目录新增29项覆盖真实登录/Guard/详情子树/静态tree、层级、部分更新、引用、重复并发、sync创建/退休/冲突及四类实际审计INSERT失败回滚。临时容器已核对身份并移除；未重跑真实Kafka/provider。见 [权限目录验收](permission-catalog-validation.md)，后文139项等为历史。

## 字典管理当前复验（2026-10-29）

独立空库19迁移、两次seed、测试前后结构校验与重复deploy无pending通过；完整DB14文件/139项，字典专项33项。真实HTTP/RBAC/树/引用/审计与Outbox失败回滚、pgvector后代路径重建/停用/恢复均覆盖；Embedding固定向量替身，未重跑真实broker/provider。临时容器已核对身份并自动移除。见 [字典验收](dictionary-validation.md)，后文106项等为历史。

## 字段配置审计当前复验（2026-10-29）

独立空库19迁移、两次seed、测试前后db:verify、重复deploy无pending均通过；完整数据库13文件/106项，其中字段/分组审计11项。覆盖实际HTTP生命周期、审计INSERT故障回滚、同版本写竞争及启用/分组停用竞争。临时容器已核对身份并自动移除；未修改其他服务。详见 [字段原子审计](custom-field-audit.md)。后文95项等为历史阶段结果。

## D-42 日志当前复验（2026-10-29）

独立临时空库完成19迁移、两次seed、测试前后结构校验与12文件/95项数据库测试；新增日志17项包含真实认证/Guard/精确筛选/闭区间/排序分页/BigInt/敏感列和撤权。环境与限制见 [日志验收](operation-log-query.md)，专用容器已移除。

## D-41 资产范围当前复验（2026-10-29）

独立空库完成 19 迁移、两次 seed、测试前后结构校验及 11 文件/78 项测试；资产由 9 项增至 12 项，涵盖 self/selected/冲突、筛选与总数、范围外 404 和预检后归属变化。首轮夹具关系名错误已修正，完整重跑通过。环境和剩余边界见 [资产范围说明](global-asset-scope.md)。

## 资产阶段当前复验（2026-10-29）

独立临时 PostgreSQL/pgvector 已完成19迁移、两次seed、11文件/75项数据库测试及清理后结构校验；新增资产HTTP9项覆盖生产认证/Guard/multipart/Prisma、归属/引用/审计/回滚，扫描/存储为替身。另真实ClamAV5项通过，存储仍为替身。专用容器已移除，旧端口不可复用。见 [资产验收](asset-validation.md)，后文66项为历史。

## Kafka 阶段数据库复验（2026-10-29）

专用临时数据库已重新执行 19 个迁移、两次 seed、结构校验、10 文件/66 项 test:db、清理后结构校验及重复 deploy 无 pending；同环境独立执行真实 Kafka 集成 6 项通过。数据库测试与 Kafka 测试顺序运行，不并发修改同一测试库。当前证据和环境见 [Kafka 集成说明](kafka-rag-integration.md)。原认证阶段的容器/端口记录为历史，不应复用。

## 当前：认证 HTTP 与最后管理员锁竞争复验

2026-10-29 新建专用临时库，完成 19 个 migration、两次 seed、db:verify、10 文件/66 项数据库测试及清理后 db:verify。新增 identity-sessions 12 项使用真实模块/BCrypt/JWT/Prisma/HTTP，覆盖注册、错误登录、轮换/重用/并发刷新、到期/退出、角色/权限/账号变化、Cookie/Origin/CSRF、管理员创建账号本人改密，以及最后管理员的停用/替换角色/混合锁竞争。每次竞争观察到至少两条 SQL 等待同一角色行锁后释放，最终一条成功、一条 409 且仅一个有效管理员与一条成功审计。详见 [认证验收说明](identity-session-validation.md)。

临时容器 `linji-auth-validation-20261029`，完整 ID `bf35e79381c7e6f49b3e6c93356a59bd3d66d9a51417bb915eb55c0fad1e0ce5`，loopback 随机端口 62411；镜像 pgvector/pgvector:pg17。验收后核对 ID/名称/AutoRemove=true，仅停止该容器并确认自动移除；不复用已移除端口、不改动用户容器与 .env。

首次测试侧 BigInt 序列化/并发账号 fixture 重名失败已修复；生产 Cookie 缺 Origin 绕过由失败测试复现并修复 Guard 后，完整 66 项通过。后文 54/41 项为历史阶段结果。当前仍缺真实 broker/provider/存储、全域授权并发、浏览器/设备和生产验收；不再把已覆盖的认证链路统称为“数据库未跑”。

## D-40 第二次独立空库复验

2026-10-29，独立临时容器 `linji-article-fields-validation-20261029`，镜像 `pgvector/pgvector:pg17`，loopback 随机端口 55386，数据库 `linji_validation`。未使用用户开发数据库或写入 .env。19 个 migration、两次 seed、测试前后 db:verify、二次 deploy 无 pending 均通过；`pnpm test:db` 9 文件/54 项全部通过，其中 knowledge-content 由 6 项增至 19 项。

新增覆盖有效字段目录、读写并集、只写隐藏、all 范围不绕过字段权限、受保护 system_admin、字段/组/schema 停用、未授权写无副作用、不可见旧值保留及已提交账号/角色/动作/入口/范围撤权。审计 INSERT 失败验证真实事务回滚。与撤权并发的事务仍遵守快照/序列化语义，不宣称立即撤销所有在途请求。

验收后核对完整 ID `a43c9f26284ae14eaf694bfaf0ee00d3693bfa2f81276a12fd566bf9277f93bf`、名称及 AutoRemove=true，仅停止该容器并确认自动移除。其他项目容器和用户服务未改动；复验需重建专用库，不能复用已移除容器的端口。当前字段授权证据见 [文章字段授权](article-field-authorization.md)。

## 首次 41 项验收历史

日期：2026-10-29。负责人：后端接口负责人。状态：下述迁移、seed、结构与数据库用例已在本地实际执行通过；远程 CI 未运行，生产部署未验收。

## 环境边界

此前 Docker Linux engine 不可用的记录属于当时的真实状态。本次复查引擎恢复，已有其他项目占用 5432，因此新建了独立临时容器 `linji-snow-validation-20261029`，随机映射至 loopback 端口 58099，只使用 `linji_validation` 数据库；未连接、迁移、重置或停止其他容器及其数据。临时容器使用测试专用凭证，未写入 .env 或修改开发环境配置。

镜像：`pgvector/pgvector:pg17`，拉取 digest `sha256:ac08538c6f8b9904c33c8224c5e5706dbe760aca29db1d096972b4052c22a75d`。实际查询版本 PostgreSQL 17.11、vector 0.8.7。验收后核对容器完整 ID、名称与 AutoRemove 配置，仅停止本次临时容器，已自动移除；其他项目容器继续运行。复验需重新创建专用数据库，58099 是本次随机端口。

## 已执行

| 检查                    | 实际结果                               | 证明范围                                                                               |
| ----------------------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm db:deploy`        | 全部 19 个迁移成功；二次执行无 pending | 空库迁移及重复 deploy；不证明旧生产数据升级                                            |
| `pnpm db:seed` 连续两次 | 均通过                                 | 基础角色/权限/初始管理员可重复初始化；测试专用账号                                     |
| `pnpm db:verify`        | 通过；测试清理后再次通过               | 19 migrations、pgvector/HNSW、7 个索引、7 个 CHECK、3 个初始角色、管理员与收益权限边界 |
| `pnpm test:db`          | 9 文件/41 项全部通过                   | 已编写的真实数据库验收，见下表；非全项目 E2E                                           |

| 文件                  | 项数 | 覆盖                                                                        |
| --------------------- | ---- | --------------------------------------------------------------------------- |
| admin-resort-scope    | 3    | 全局范围/生命周期、审计及回滚                                               |
| ai-conversations      | 4    | 消息幂等/租约、owner、限流与近期问题边界                                    |
| community             | 5    | 动态/图片关联、本人编辑与审核审计                                           |
| knowledge-content     | 6    | self/selected、作者、首次发布时间、审计/Outbox/回滚、公开分类、项目知识版本 |
| managed-role-scope    | 3    | 角色范围及授权写入边界                                                      |
| member-favorites      | 5    | 本人隔离、幂等/并发唯一、公开分类、失效目标取消与分页                       |
| merchant-resort-scope | 4    | 商家范围交集、归属与引用、状态/收益审计                                     |
| public-resort-query   | 5    | 数据库筛选/全部标签、距离/空值/稳定分页、SQL 参数边界                       |
| rag-source-visibility | 6    | pgvector 来源当前状态、公开字段/分类、依赖链与 Inbox 真实流程               |

## 首轮失败与修复

首轮结果 30 通过、6 失败、5 跳过，5 个文件失败；不能把首次执行当作通过。真实 SQL 暴露 Inbox LockToken 的 UUID/text 类型错误，生产查询补 `::uuid`。若干此前未执行的测试夹具使用 inactive，但字典 CHECK 只允许 active/disabled；已改为 disabled，不放宽数据库约束。AI 历史问题测试的 streaming 消息缺少必要 token/过期时间，已补真实合法租约，不删除 CHECK。修复后完整 41 项通过。

清理后第二次 db:verify 首次调用漏设 INITIAL_ADMIN_ACCOUNT 而失败；在同一测试库显式恢复验证账号环境变量后再次通过。该失败属于运行参数，未修改验证器来跳过管理员校验。

## 独立复验

只在专用测试库执行，先设置 DATABASE_URL、INITIAL_ADMIN_ACCOUNT 和 INITIAL_ADMIN_PASSWORD 为临时测试值；勿指向开发/生产数据库。按顺序运行 db:deploy、db:seed 两次、db:verify、test:db。Vitest database 配置禁止文件并行，测试创建唯一 fixtures 并清理，部分可见性测试会暂时改变公共字典类型并在 finally 恢复。不要在共享数据库并发运行其他测试/业务。

CI 已使用 pgvector/pg17 服务执行同一路径，但本地通过不等于远程 CI 运行。尚未验证真实 broker 重投/重平衡、S3/ClamAV/provider、登录/refresh HTTP 与最后管理员并发的真实全链路、浏览器/设备、性能、备份恢复或生产发布。新增数据库用例或生产持久化变化后必须按影响范围复验。
