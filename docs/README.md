# Backend 文档索引

## 当前教程入口（2026-11-12）

- [三仓协作与技术学习路线](guide/learning-roadmap.md)
- [本地开发教程](guide/development.md)
- [部署与发布教程](guide/deployment.md)
- [公开仓库与 SDK / 凭证边界](guide/repository-security.md)
- [文章图片不设固定数量上限](engineering/article-images-20261112.md)

以下为历次工程与验收记录，状态按各自日期理解。


- [2026-11-07 个人笔记收藏与官网发布](engineering/member-center-20261107.md)、[报告](validation/member-center-20261107.json)：OpenAPI 1.54.0 / 27 迁移，社区审核复用、动态收藏与默认列表兼容、克隆验收、正式服务和数据数量核对、备份回滚。

- [2026-11-06 富文本API生产部署](engineering/markdown-release-20261106.md)、[报告](validation/markdown-release-20261106.json)：26迁移、备份恢复演练与克隆验收完成，原内容不变；旧未部署状态为历史。

- [2026-11-06 Tiptap / Markdown](engineering/markdown-editor.md) - local scope and [validation](validation/markdown-20261106.json).

- [2026-11-05服务器部署与本地Embedding隧道](engineering/server-deployment.md)：API、PG、Kafka、存储和扫描已运行，线上真实链已验；旧阶段“未部署”按当时范围理解。

2026-11-05 收尾：五项闭环实现已交付。Backend1494单测/177框架HTTP/865真实DB、8项真实服务场景通过；Web3062业务测试及双生产构建通过；App1238测试、三平台导出及4项Android实操通过。完整浏览器、iOS/真机与新增依赖真实Kafka仍待验；构建和API测试不代替完整三端点击验收。 详见[本轮报告](validation/business-closure-20261105.json)。

- [2026-11-05 业务闭环工程说明](engineering/business-closure.md)
- [本轮验收报告](validation/business-closure-20261105.json)

维护：本仓库维护者。核对：2026-11-04。[独立启动与检查](../README.md)。工程说明通常记录指定日期的专项，旧版本/计数适用于当时范围；当前产品结果以README和对应验收报告为准。

## 回填运维

- [历史数据回填CLI真实验收与恢复](engineering/rag-backfill-cli-validation.md)

## 工程与专项

- [五类公开业务来源真实Kafka/RAG验收](engineering/five-source-kafka-rag.md)

- [管理端资产签名前后的读取授权](engineering/admin-asset-read-authorization.md)
- [管理端资产与真实私有存储验收](engineering/admin-assets-real-storage.md)
- [管理端授权真实HTTP验收](engineering/admin-authorization-http-validation.md)
- [系统配置生产HTTP与持久核对](engineering/admin-config-http-validation.md)
- [D-48 管理员重置密码](engineering/admin-password-reset.md)
- [全局雪场可空数值的契约类型修正](engineering/admin-resort-contract-types.md)
- [全局雪场响应契约补齐](engineering/admin-resort-response-contract.md)
- [全局雪场写事务授权与引用校验](engineering/admin-resort-transaction-authorization.md)
- [收益完整读取与会话撤销 HTTP 核对](engineering/admin-revenue-read-http.md)
- [AI 管理浏览器验收夹具](engineering/ai-browser-fixture.md)
- [AI 会话与消息实现说明](engineering/ai-conversations.md)
- [AI 会话 HTTP、SSE 与 pgvector 联合验收](engineering/ai-http-rag-validation.md)
- [App AI 真实 HTTP 与 pgvector 验收](engineering/ai-mobile-http-validation.md)
- [AI 管理真实数据库验收](engineering/ai-operations-database-validation.md)
- [AI 管理运维接口](engineering/ai-operations.md)
- [AI 跨页面恢复的独立 HTTP/SSE 核对](engineering/ai-runtime-recovery-http.md)
- [AI 流式回答的会话与权限复核](engineering/ai-stream-authorization.md)
- [App 收藏恢复的独立 HTTP 核对](engineering/app-favorite-recovery-http.md)
- [D-36 公开文章收藏状态](engineering/article-favorite-state.md)
- [文章字段授权与 D-40 字段目录](engineering/article-field-authorization.md)
- [文章管理真实 HTTP 续验](engineering/article-lifecycle-http-validation.md)
- [文章事务授权与输入边界](engineering/article-transaction-boundaries.md)
- [媒体管理生产 HTTP 与持久核对](engineering/asset-admin-http-validation.md)
- [资产停用事务授权](engineering/asset-deletion-authorization.md)
- [图片上传分阶段事务授权](engineering/asset-upload-authorization.md)
- [图片资产、真实数据库与扫描器验收](engineering/asset-validation.md)
- [AI 审计存储引用声明（D-52）](engineering/audit-citations-contract.md)
- [授权资源目录与角色快照验收](engineering/authorization-resource-catalog.md)
- [Community DDD 分层与事务](engineering/community-ddd.md)
- [App 社区真实 HTTP 与持久化验收](engineering/community-mobile-http-validation.md)
- [社区审核生产 HTTP 与持久核对](engineering/community-moderation-http-validation.md)
- [社区关键词字面查询复验](engineering/community-query-recovery.md)
- [社区事务内授权与引用并发](engineering/community-transaction-authorization.md)
- [社区 HTTP / PostgreSQL 验收](engineering/community-validation.md)
- [App 动态发布编辑：真实 HTTP、扫描与持久化验收](engineering/composer-http-validation.md)
- [字典与权限目录的事务内授权](engineering/configuration-write-authorization.md)
- [Backend 独立容器与发布准备](engineering/container-release.md)
- [项目知识与 Outbox 运维持久化验证](engineering/content-events-http-validation.md)
- [字段与字段分组的原子审计](engineering/custom-field-audit.md)
- [自定义字段的 OpenAPI 类型](engineering/custom-field-contract-types.md)
- [字段组详情接口](engineering/custom-field-group-detail.md)
- [字段与分组真实 HTTP 续验](engineering/custom-field-http-validation.md)
- [动态字段配置到商家写入与公开读取验收](engineering/custom-field-workflow-http.md)
- [字段与分组的事务内写入授权](engineering/custom-field-write-authorization.md)
- [全局工作台汇总](engineering/dashboard-summary.md)
- [PostgreSQL 加密备份与新库恢复](engineering/database-backup-restore.md)
- [本地 PostgreSQL / pgvector 验收](engineering/database-validation.md)
- [九个业务上下文的 DDD 内层依赖检查](engineering/ddd-boundary-validation.md)
- [字典项详情与边界校验](engineering/dictionary-item-detail.md)
- [字典管理与层级 RAG 验收](engineering/dictionary-validation.md)
- [字典层级管理生产 HTTP 与持久核对](engineering/dictionary-workflow-http.md)
- [Expo Web 认证协议真实 HTTP 与持久化验收](engineering/expo-web-auth-http-validation.md)
- [HTTP 与 AI 流式失败诊断](engineering/failure-diagnostics.md)
- [当前源码的完整业务数据库回归](engineering/full-database-regression.md)
- [资产管理数据范围](engineering/global-asset-scope.md)
- [全局雪场管理与公开查询的 DDD 分层](engineering/global-public-resort-ddd.md)
- [全局雪场生产客户端 HTTP 与持久核对](engineering/global-resort-http-validation.md)
- [全局雪场管理的数据范围](engineering/global-resort-scope.md)
- [认证会话与最后管理员的真实数据库验收](engineering/identity-session-validation.md)
- [独立安装与编译后 HTTP 验收](engineering/independent-start-validation.md)
- [Kafka 长任务心跳与失败排空](engineering/kafka-handler-heartbeats.md)
- [Kafka、Outbox、Inbox 与 pgvector 集成验收](engineering/kafka-rag-integration.md)
- [Kafka 与真实模型的组合链路验收](engineering/kafka-real-rag-validation.md)
- [Kafka 停机恢复与多消费者再平衡验收](engineering/kafka-recovery-validation.md)
- [真实 Kafka 安全连接验收](engineering/kafka-secure-broker-validation.md)
- [Kafka TLS 与 SASL 连接配置](engineering/kafka-transport-security.md)
- [知识内容 DDD 与文章数据范围](engineering/knowledge-content-ddd.md)
- [App 知识列表真实 HTTP 与持久化验收](engineering/knowledge-list-http-validation.md)
- [项目知识事务授权与文章引用验收](engineering/knowledge-write-validation.md)
- [独立 Linux Kafka 验收](engineering/linux-kafka-validation.md)
- [登录限流：双桶事务与可信 IP](engineering/login-rate-limit.md)
- [收藏模块 DDD 与公开目标一致性](engineering/member-favorites-ddd.md)
- [商家雪场与收益的 DDD 分层](engineering/merchant-resort-ddd.md)
- [商家雪场生命周期真实 HTTP 验证](engineering/merchant-resort-lifecycle-http-validation.md)
- [商家雪场范围与写入审计](engineering/merchant-resort-scope.md)
- [商家雪场事务授权、字段快照与引用一致性](engineering/merchant-resort-transaction-authorization.md)
- [MinIO源码构建与真实私有存储验收](engineering/minio-source-storage.md)
- [对话与 Embedding 适配器的传输及取消](engineering/model-provider-transport.md)
- [三类业务来源的真实 Kafka/RAG 验收](engineering/multi-source-kafka-rag.md)
- [Windows 原生 Kafka / PostgreSQL 集成验收](engineering/native-kafka-validation.md)
- [Windows 隔离 PostgreSQL 验收](engineering/native-postgres-validation.md)
- [Windows 独立私有存储验收](engineering/native-storage-validation.md)
- [操作日志只读查询](engineering/operation-log-query.md)
- [D-05 Outbox 运维](engineering/outbox-management.md)
- [本人动态查询（D-03）](engineering/own-dynamics.md)
- [D-30 本人资料与头像资产](engineering/own-profile.md)
- [本人资产读取与删除的当前授权](engineering/owned-asset-access.md)
- [权限目录真实 HTTP 验证](engineering/permission-catalog-http-validation.md)
- [权限目录与单节点详情验收](engineering/permission-catalog-validation.md)
- [App资料编辑真实HTTP验收夹具](engineering/profile-http-validation.md)
- [项目知识来源链接契约校正](engineering/project-knowledge-contract.md)
- [项目知识读取生产 HTTP 与持久核对](engineering/project-knowledge-read-http-validation.md)
- [公开内容编译服务与隔离数据库验收](engineering/public-content-http-validation.md)
- [公开知识目录查询验收](engineering/public-knowledge-directory.md)
- [RAG 文章字段分组停用验收](engineering/rag-field-group-validation.md)
- [历史项目知识的 RAG 复验](engineering/rag-legacy-project-validation.md)
- [RAG 生成期间的来源快照复核](engineering/rag-live-evidence.md)
- [RAG 来源端口、Inbox 与 Kafka 生命周期](engineering/rag-source-ddd.md)
- [RAG 来源管理持久化联调](engineering/rag-source-http-validation.md)
- [RAG 来源实时校验与存量回填](engineering/rag-source-visibility.md)
- [DeepSeek 与真实 Embedding 接入计划](engineering/real-ai-provider-integration.md)
- [真实 BGE-M3 与 DeepSeek 的 RAG 验收](engineering/real-rag-validation.md)
- [App雪场列表与收藏真实HTTP夹具](engineering/resort-list-http-validation.md)
- [收益恢复真实 HTTP 验证](engineering/revenue-recovery-live-http.md)
- [收益读写与CSV任务恢复](engineering/revenue-recovery.md)
- [收益 HTTP、CSV 与审计一致性验收](engineering/revenue-validation.md)
- [角色读取与授权目录真实 HTTP 验证](engineering/role-read-http-validation.md)
- [角色默认范围与授权保存](engineering/role-scope-authorization.md)
- [角色写入事务授权](engineering/role-write-authorization.md)
- [全部 HTTP 路由授权与角色分页边界](engineering/route-authorization-validation.md)
- [S3运行时请求时限与失败状态验证](engineering/s3-deadline.md)
- [文件扫描总时限与超时状态验证](engineering/scanner-deadline.md)
- [App自助改密真实HTTP验收夹具](engineering/settings-http-validation.md)
- [Backend 工程实践来源](engineering/skills-practices.md)
- [独立源码导出与冷安装](engineering/source-export.md)
- [恢复后数据库与 S3 图片只读核验](engineering/storage-recovery-verification.md)
- [系统配置与公开品牌、政策数据](engineering/system-config.md)
- [账号管理写事务授权](engineering/user-write-authorization.md)
- [后台任务与连接资源的停机顺序](engineering/worker-shutdown.md)

## 历史快照

- [历史快照：backend/README.md](history/README-20261104.md)

## RAG回填专项

- [真实回填与三仓工程报告](validation/rag-backfill-cli-20261104.json)

## Android原生模拟器专项

- [11项真实原生流程及三仓工程报告](validation/android-emulator-20261104.json)

## SDK58原生图片上传修复

- [真实头像上传与三仓复验](validation/native-upload-20261104.json)

## 当前验收入口

- [五类公开来源真实消息/模型与三仓工程报告](validation/five-source-kafka-rag-20261104.json)

- [最近产品验收报告](validation/admin-asset-read-authorization-20261104.json)
- [本轮文档整理核对](validation/document-lifecycle-20261104.json)

validation中的其他日期报告和外部冻结目录是原始阶段证据；不得覆盖旧报告冒充复验。发布、上传及远程CI状态见独立README。
