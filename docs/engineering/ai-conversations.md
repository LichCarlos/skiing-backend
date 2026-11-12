# AI 会话与消息实现说明

2026-11-03 当前增量：[生成期间来源快照复核](rag-live-evidence.md)已接入：本轮实际提示词来源在调用模型前、每片段、结束及保存前后重新核对；不再仅依赖初次检索过滤。未改变客户端协议、OpenAPI1.50.0/143操作或历史消息保留；检查与提交竞争及真实数据库/供应商验收仍待完成。

2026-11-02 当前增量：[AI 流式会话与权限复核](ai-stream-authorization.md)补齐每片段、保存前后及幂等回放检查，失效时停止后续输出并取消上游；不将请求 Guard 当作长连接全程授权。OpenAPI 保持1.50.0/143操作；源变化、提交竞争和真实数据库/设备边界见新增说明，下方旧版本及“在途撤权未解决”段落按历史范围阅读。

> 2026-10-30 当前补充：新增真实登录、HTTP/SSE、pgvector、持久化联合测试 22 项，与既有仓储数据库测试共 26 项；补齐分页偏移和消息运行时类型校验。当前契约 1.38.0，无新依赖或迁移。完整范围与未解决的在途撤权/来源变化边界见 [联合验收](ai-http-rag-validation.md)。下文旧版本和当时的“未跑”描述为历史记录，真实供应商与设备仍未验。

> 2026-10-29 后续数据库复验：会话真实 PostgreSQL 4 项已通过，涵盖幂等/租约、owner、限流与近期问题边界；真实 provider/设备仍未验。 19 个迁移、两次 seed 和结构复验亦通过。下文旧“未跑”描述保留为当时阶段记录，当前验证范围以 [数据库验收](database-validation.md) 为准。

更新时间：2026-10-29。当前 OpenAPI 为 `1.27.0`。本页描述已实现的服务端行为；Expo 已接会话列表/详情、SSE 回复与引用展示，真实 PostgreSQL/provider/设备联调和全系统验收尚未完成。

## 接口与权限

所有地址以 `/api/v1` 开头，要求有效登录会话和 `ai:conversation:use`。该 grant 已加入注册用户初始模板及系统管理员权限目录；现有环境需要执行 seed 或由系统管理员配置角色授权。商家是业务身份，不能用角色键判断是否可使用 AI。

| 方法与路径                            | 请求                                    | 响应                                                 |
| ------------------------------------- | --------------------------------------- | ---------------------------------------------------- |
| `POST /ai/conversations`              | `{}`，拒绝额外字段                      | 会话摘要                                             |
| `GET /ai/conversations`               | `page=1&pageSize=20`，pageSize 最大 100 | `{items,page,pageSize,total}`                        |
| `GET /ai/conversations/:id`           | UUID 会话 ID                            | 摘要及时间正序完整消息                               |
| `DELETE /ai/conversations/:id`        | UUID 会话 ID                            | 204；写 DeletedAt 并保留消息；重复本人删除仍返回 204 |
| `POST /ai/conversations/:id/messages` | `{clientRequestId: UUID, content}`      | SSE                                                  |

所有权由认证主体派生。详情/发送排除软删除会话，列表仅查本人未删除会话；他人会话与不存在会话均返回 404。列表按 `UpdateTime DESC, ConversationId DESC` 稳定排序；历史按 `CreateTime ASC, MessageId ASC` 排序。生成中和失败的 assistant 占位不出现在历史和消息计数中；用户消息保留。

SSE 使用 POST fetch 流，不采用只支持 GET 的原生 EventSource：

```text
event: delta
data: {"text":"雪场资料"}

event: completed
data: {"messageId":"2","role":"assistant","status":"complete","content":"雪场资料","citations":[],"createdAt":"2026-10-29T00:00:00.000Z"}

```

`completed` 只在完整回复与 citations 已提交数据库后发送；幂等回放只发送 completed。SSE 不包普通 JSON envelope；响应头提交前的参数/所有权/频控错误为统一 JSON 错误（400/404/409/429）；提交后的生成失败为 `event: error`，data 为脱敏的 `{code,msg,traceId}`，随后关闭连接。客户端不可把半截回答当作已完成消息。

## 一致性与恢复

- content trim 后非空，最多 4000 Unicode code point。每用户滚动 60 秒最多 5 个新逻辑请求，跨会话累计，软删除不清除限流记录。
- `beginMessage` 在数据库事务中取得用户 advisory lock 与会话行锁，检查所有权、幂等键和频控，再创建用户消息与 assistant 空占位。外部 Embedding/Chat 请求在事务外执行。
- 用户消息的 `(ConversationId,ClientRequestId)` 唯一；assistant 的 `ParentMessageId` 唯一。相同 key 不同 content 返回 409；生成中重复请求返回 409；完成请求直接重放，不再次调用模型或计数；失败请求允许复用同 key 重试。
- 生成任务租约 5 分钟，单次应用用例信号上限 4 分钟，模型/Embedding 另有各自 HTTP timeout。进程中断后，租约到期可重试；每次 claim 的 token 在完成/失败时校验，旧实例不能覆盖新结果。外部模型调用与数据库提交不具备跨系统 exactly-once；进程在模型完成但提交前崩溃时重试仍可能产生供应商费用。
- 软删除与完成写入锁定同一会话行。删除先提交时，完成写入拒绝；完成先提交时，后续软删除保留已写消息并隐藏会话。断开 SSE 会取消生成并把未完成占位标为 failed。
- 每次回答调用 RagAnswerService，按本轮服务端 principal 重新过滤来源。近期用户问题参与检索和上下文，具体预算、隔离规则与局限见下节。生成模型名来自配置，实际 provider 可用性须以真实账号验证。

## 近期问题上下文

`beginMessage` 在已验证本人且未删除的会话事务内，读取当前用户消息 ID 之前、已有 completed assistant 且完成时间不晚于本条用户消息时间的最近 4 个用户问题。查询只选择 Content，不读取历史 assistant 正文或 citations。失败/生成中轮次、其他会话、当前问题、后续问题和稍后才完成的回答均排除。重试继续使用原用户消息的 ID/时间边界；完成幂等回放不读取历史，也不调用模型。这不是持久化的上下文快照，后续另行修改历史数据仍可能影响重试上下文。

纯领域函数从最近问题中选择完整问题，合计最多 2000 Unicode code point；遇到超预算问题就停止向更早回溯，避免截断后改变语义。Embedding 输入优先保留当前问题，再从近到远添加历史问题，总计最多 4000 code point；当前问题已占满预算时不添加历史。模型收到按时间正序排列的历史问题 JSON、本条问题和本轮授权资料。历史仅帮助理解指代，不能提供事实或有效引用；无本轮证据仍确定性拒答。

每条来源最多 4000 code point，标题最多 300，引用摘要最多 360。完整 messages JSON UTF-8 大小上限 64000 字节，包含转义和元数据；超限时从末尾移除来源并同步移除 citations，引用序号保持连续。此为文本传输预算，不等于供应商 tokenizer 的精确 token 上限，真实模型接入时仍需按该模型上下文容量验证。

本次没有新增接口、迁移、依赖、独立问题改写或会话摘要。历史 AI 回复可能含已撤回或不再授权的资料，因此不重新发送；若“第二个怎么样”只指向上一条 AI 回答，提示模型要求用户补充具体名称。提示词规则不保证模型完全遵循，真实引用准确性、检索召回和指代效果仍需 provider 评测。其他待办还包括当前事实的结构化查询、来源回填及管理。

## 迁移与测试

本轮 migrations 新增会话 DeletedAt/索引、assistant 状态、父消息引用和生成租约。旧 assistant 记录迁移为 completed。部署需先执行 `pnpm db:generate`、`pnpm db:deploy` 和 `pnpm db:seed`。会话保留期限/物理清理任务尚未定版，本次不实现自动物理删除。

```powershell
pnpm check
pnpm test:e2e
pnpm build
```

真实数据库测试必须配置专用、已迁移的测试数据库，再执行 `pnpm test:db`。测试仅创建并清理自己生成的账号及关联数据；不重置 schema。CI PostgreSQL/pgvector service 已接入该命令，覆盖并发频控、幂等、跨用户隔离、租约 fencing、软删除保留及删除后的完成写入拒绝。本机历史阶段曾因 Docker daemon 不可用而未执行；现已在专用 pgvector 容器完成数据库与联合测试，当前证据以本页顶部链接为准。单测和替身 HTTP 测试仍不等同于真实供应商或设备验收。
