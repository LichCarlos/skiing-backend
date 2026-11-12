# 字段与字段分组的原子审计

2026-10-31 更新：写事务现已复核完整有效授权，并对公开字段启用核实受保护管理员身份，见 [事务内写入授权](custom-field-write-authorization.md)。下文 2026-10-29 的“仅复核账号”及测试数字保留为历史记录。

2026-10-29，按 API-M10 既有管理写入审计要求实施。没有新增 HTTP 路由、请求字段、依赖或 migration；OpenAPI 保持 1.31.0。

## 实现

字段创建、编辑、启用、软停用，以及分组创建、编辑、软停用，均在同一个 Serializable 事务中完成配置写入、结果读取和 OperationLog INSERT。字段版本条件保留在 UPDATE 中；版本失配或 PostgreSQL 序列化冲突返回 409，不留下配置变更或成功日志。分组仍有活动字段时不能停用。

Controller 从认证 Principal、服务端生成的 traceId 和请求信息构造必传的 CustomFieldAuditContext，经 Application、Repository 端口传至 Prisma；DTO 不接收审计操作者。事务读取账号快照并要求账号仍有效，查不到或已停用则回滚并拒绝。此处理不重载完整角色授权，不承诺终止所有与撤权并发的在途请求。

字段日志使用 system:field:create/update/delete；启用使用 update，状态差异写在摘要中。分组使用 system:field-group:create/update/delete。记录目标类型与 ID、操作者 ID/账号快照、结果、traceId、数据库时间。分组目标 ID 为 entityType:groupKey。

Metadata 仅记录结构与状态摘要：实体/分组/字段键、类型、排序、schemaVersion、公开性及功能开关、默认值/校验是否存在，以及编辑属性名。排除标签、默认值内容、校验表达式、分组可见性表达式与请求正文。IP/UserAgent 受既有列长度限制。D-42 只读日志 API 继续不查询、不返回 Metadata、Reason、IP、UserAgent。

字段创建/编辑/启用会在事务内复核分组和关联字典类型的活动状态；分组停用会在事务内检查活动字段。Serializable 检测写入竞争，冲突返回 409，调用方重新读取后再提交。默认值的字典项语义校验仍属于现有 Application 校验，未在本轮解决与字典项变更并发的全部情况。字段公开性变更的 RAG 重建/失效联动也不属于本轮验收。

## 实际验收

- 三仓独立 pnpm install --frozen-lockfile 通过。
- Backend check：110 文件/639 项；HTTP：3 文件/80 项；lint、类型检查、build/OpenAPI 通过。
- 独立空库：19 migrations、两次 seed、测试前后 db:verify、再次 deploy 无 pending；完整数据库 13 文件/106 项通过。
- 新增 custom-field-audit.db-spec.ts 的 11 项：生产认证/Guard/HTTP/Prisma 完整配置生命周期、只读日志查询与脱敏、伪造审计输入/越权拒绝、同版本并发更新、启用与分组停用竞争、六类仓储写入的实际审计 INSERT 故障回滚、事务内分组复核。
- INSERT 故障用超出 TraceId 列长度的内部测试上下文触发真实 PostgreSQL 错误；不替换 Prisma、不放宽约束。六类操作故障后配置快照、版本、日志数量保持原值。HTTP 不允许客户端提交该内部上下文。
- Web check 115 项、官网/Admin production build；App check 64 项、Doctor 20/20、iOS/Android/Web export 通过。本轮两客户端无业务改动。

专用容器 linji-custom-field-validation-20261029，完整 ID a8dc3133e97257d1b5541c4e1595ab47a55f73adda4a602d373fba10fc8031c1，pgvector/pgvector:pg17，loopback 随机端口 58502。验收后核对 ID/名称/标签/AutoRemove 后停止，已确认自动移除；未改动其他项目容器或既有官网/Admin 服务。复验应新建专用空库，不能复用此历史端口。

OpenAPI SHA-256 仍为 c7587cc03993c0924b5883be6dcdbe8aca3c12121750fca4a6de96c5f3f9760d，Web/App 快照与生成类型校验通过。未提交或推送；未重跑真实 Kafka/ClamAV。字典/权限目录完整数据库验收、配置/Outbox/AI 管理、真实对象存储/provider、浏览器/设备、生产与恢复验收仍待完成。
