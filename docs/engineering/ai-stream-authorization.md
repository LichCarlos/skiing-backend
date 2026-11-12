# AI 流式回答的会话与权限复核

2026-11-03 原生数据库续验：在隔离的Windows PostgreSQL17.11/pgvector0.8.1执行完整34文件830项数据库套件，全部通过，含本页新增三项原会话/AI授权变化场景。前后结构校验及临时实例停止已核对，见[实现与脱敏证据](native-postgres-validation.md)。因此下文“新增数据库用例未执行”为历史阶段状态；源变化四项也在同轮通过，仍不证明供应商、容器、真机或即时撤权/提交原子互斥。

2026-11-03 来源续验：本轮已补齐[生成期间的来源快照复核](rag-live-evidence.md)，在模型调用/片段/完成及保存前后检查业务可见性和分块内容。下文“没有每片段重读来源”为上一阶段限制；当前仍不保证检查/输出/提交原子互斥，也不改变历史保留规则。新增真实来源数据库用例待执行。

2026-11-02；沿用 API-AI-02、OpenAPI 1.50.0 / 143 操作，未新增 HTTP 接口、DTO/VO、依赖或数据库迁移。

## 问题与行为

原实现只在请求 Guard 处验证会话及 AI grant，之后一直使用请求开始时的 principal。模型生成期间撤销会话、停用角色或移除授权，仍可继续输出片段及 completed。4 项新增用例先复现失败，修复后通过，日志 `ai-stream-access-before.log` 保留。

Application 新增 `AiStreamAuthorization` 端口；Infrastructure 的 `CurrentAiStreamAuthorization` 复用 IdentityAccess 会话仓储和 principal 解析。AI 模块显式导入 IdentityAccess 模块，后者导出会话仓储端口；Application 不引用 Prisma、HTTP Request 或其他上下文的 Infrastructure。

Controller 只将 AccessTokenGuard 写入的 `authenticatedSessionId` 传给用例，客户端 DTO 不接收 sessionId。复核读取原会话及用户 ID，要求会话未撤销/未过期、当前账号有效、仍有有效角色提供 `ai:conversation:use`，并要求当前有效 RAG 访问过滤结果与请求快照相同。商家归属或 RAG 权限/范围改变时结束本轮，重新请求再按新范围检索；无关权限或角色名称改变不会中断。

检查点：开始创建/恢复逻辑消息前、beginMessage 返回后、每个非空模型片段输出前、保存完整回复前、保存后发送 completed 前；已完成请求的幂等回放也在返回前重新检查。每次均读取当前状态，不使用进程缓存，不修改已有 grants 合并及 RAG 过滤语义。

在 headers 发送前，会话失效返回 401，权限/有效 RAG 范围改变返回 403；存储故障保持失败。已经发送 headers 时沿用既有脱敏 `event:error`，不暴露存储错误或权限详情。用户已收到的片段无法撤回；客户端仍须把 completed 之前的片段视为未确认内容。

本轮 generation 使用独立 AbortController，与客户端取消及 240 秒超时组合。失败/结束时 abort，并通过 async iterator return 关闭模型流。未保存回复使用原 generation token 标为 failed，正文保持为空；已保存但未能回传 completed 的回复不改写失败，后续需在恢复授权后按原幂等键或会话详情核对。

## 验证

- Application 16 项，包括原有生成生命周期；新增6项覆盖首步拒绝、片段撤权、尾片段后撤权、回放撤权、提交期间撤权，以及实际 Chat HTTP 适配器取消响应体。
- 授权适配器18项：每次重新读取、会话撤销、账号/角色/权限失效、归属/范围改变、无关授权不误拒绝，以及存储异常。
- HTTP 专项13项，其中新增6项使用真实 Nest Guards、Controller、Application 和本轮授权适配器，验证四类在途失败及两类 headers 前拒绝。会话/身份/对话仓储和模型为替身，不记为数据库集成结果。
- `test/ai-conversations-http.db-spec.ts` 新增3项持久化验收：模型首片段后暂停，在实际 PostgreSQL 提交会话撤销、账号角色解绑或账号停用，再恢复模型；要求只收到首片段和 error，assistant 保持 failed 空正文并关闭供应商流。已纳入现有数据库 CI 测试选择；本机 Docker 按用户要求不重启，新增3项尚未执行。

本轮完整三仓检查与构建结果见共享阶段交付记录；本页专项证据不替代真实数据库、供应商或设备验收。

后端最终 frozen install、完整 check（137 文件 / 1172 项）、7 文件 / 149 项 HTTP/框架测试和 build 通过；新增数据库用例加入后再次 lint/typecheck 通过。编译后的 OpenAPI 导出在数据库/Kafka 指向不可达地址时成功，快照字节与 Web/App 锁保持一致。日志前缀 `ai-stream-access-`，包括失败复现、专项与全量结果；未执行真实数据库测试或外部模型调用。

## 仍需验收的边界

检查在消息边界执行，模型长期无片段时没有后台轮询或即时撤权推送，会在下一片段/完成检查或超时取消；不宣称撤权瞬间终止全部网络工作。每个非空片段增加会话和授权读取，性能、连接池和高并发开销待测，不能为降低开销而跳过权限检查。

会话与 principal 读取、生成提交不是同一串行化事务。检查之后到发送/提交之间仍有竞争窗口；提交期间撤权可能已经保存完整回复，此时保存后检查阻止 completed，不能宣称撤权与生成提交实现原子互斥。访问 JWT 到期尚未作为长连接独立截止时间，原会话到期由当前会话检查处理。

该修复没有在每片段重读所有业务来源。检索后的来源撤回、人工停用或字段公开性变化，对当前已检索材料及模型已接收提示词仍需进一步处理；历史对话/引用保留策略保持现有协议，未自动删除。真实 PostgreSQL 竞争、源可见性变化、供应商和设备验收仍未完成。
