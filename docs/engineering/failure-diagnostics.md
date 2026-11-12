# HTTP 与 AI 流式失败诊断

日期：2026-11-04。状态：实现、专项及三仓独立工程复验通过，生产监控与真实供应商故障根因待验。OpenAPI 1.51.1 / 143 操作、24 项迁移保持。

前轮[三类来源真实 RAG](multi-source-kafka-rag.md)首轮有两次对话 HTTP 500；复验未重现，原始故障根因仍未确定。本阶段补齐后续排查所需的服务端诊断，不能将它描述为修复了先前供应商或网络故障。

## 事件与字段

| 事件                       | 触发位置                                            | 服务端记录                                |
| -------------------------- | --------------------------------------------------- | ----------------------------------------- |
| `http_request_failed`      | 全局异常过滤器处理 HTTP 5xx，包含 AI 首个片段前失败 | 服务端 traceId、HTTP status、failure 分类 |
| `ai_message_stream_failed` | AI 响应头已发送，继续生成/授权/持久化失败           | 同一服务端 traceId、failure 分类          |

`failure` 固定为 `{kind,upstreamStatus,code}`。kind 为 `upstream_http / timeout / aborted / network / database / unexpected`；upstreamStatus 仅取内部类型 `UpstreamHttpError` 的有效数字，不能从任意错误消息猜测。code 仅接收源码白名单中的 Node/Undici/TLS 或 Prisma 代码。cause 最多检查四个 Error，循环和未知类型降级为 unexpected；未知错误名和代码均不输出。

traceId 使用现有中间件为每次请求生成的 UUID，响应头 `x-trace-id` 与错误响应/事件共用；不采用客户端传入的 x-trace-id。诊断只接受 UUID 格式，不输出自由文本 traceId。普通 4xx 不由全局过滤器重复记为系统故障；流开始后的撤权仍按流失败记录。客户端已经断开或请求已取消时保持原有立即结束行为。

日志不携带错误 message/stack、URL/查询参数、请求正文、历史问题、引用正文、供应商响应体、请求头、Cookie、Token、账号、IP 或数据库查询元数据。JSON 结构交给 Nest Logger 输出，时间和日志等级沿用既有 logger。诊断属于运行日志，不能写入可供管理员读取的操作审计正文。

## 协议和资源处理

客户端协议保持：响应头前为原有脱敏 JSON 错误；SSE 开始后仍为 `AI_GENERATION_FAILED`，不额外公开供应商状态或错误原因。未完整生成的回答沿用原来的 failMessage 和租约规则，不保存为完整 assistant 回复；不自动重发提问，不增加模型调用或修改幂等键语义。

供应商非成功 HTTP 仍立即取消响应体，再抛带安全状态元数据的错误。Embedding 读取 JSON 时保留内部 cause；请求已超时则优先保留 deadline reason。Chat 在读取响应体时同样保留实际超时/取消原因，原有 reader 取消和连接关闭保持。超时和外部取消必须分开统计，不能把用户离开页面都计为供应商超时。

## 排查步骤

1. 取得用户错误回执中的 traceId；若错误页不显示，按已有浏览器网络记录检查响应头。无需索取正文、Cookie 或密钥。
2. 在后端现有标准输出日志按 traceId 查询上述事件，查看 failure.kind 和白名单 code。`upstream_http` 的状态表示上游响应，客户端收到的 HTTP 状态仍遵守原有接口。
3. 429 检查供应商限额/费用；401/402 检查后端供应商账号配置；network 检查 DNS/TLS/连接；timeout 检查时延和超时配置；database 按已列出的 Prisma 代码检查连接池或事务。unexpected 保留为未知，不从分类直接推断根因。
4. 先核对原请求结果，再使用现有会话/幂等恢复流程；诊断事件本身不授权重放。运维应在部署环境为标准输出配置访问控制、保留期和告警，本仓尚未部署集中式日志或监控。

## 验证范围

新增分类测试覆盖上游状态、网络/超时、数据库白名单、未知值、循环/超深 cause、异常 getter 与 traceId；全局过滤器测试验证不泄密和原错误包络。AI HTTP 测试验证流前 500、流后断连，以及本地真实 HTTP 上游的 503 和正文超时贯穿正式 Nest/Controller/Provider，并断言单次上游请求、相同 traceId、无完整回复保存。

实际业务库、认证和 RAG 检索在 HTTP 框架测试中使用既有替身；本地供应商只发送合成文本，无外部收费模型调用。本轮未重跑真实 BGE-M3/DeepSeek、Kafka 或完整数据库专项；此前专项按各自历史版本保留，不宣称本轮真实供应商可用性、浏览器/设备或生产故障恢复通过。三仓新D盘副本独立冻结安装/check通过：Backend1385单测/20源码工具/177HTTP框架、构建与编译OpenAPI、80项诊断/供应商专项及17项AI HTTP专项；专项为全量中的复核子集，不累计计数。Web3045业务/20源码/20发布工具、双无缓存构建与standalone；App1217业务/20源码/10产物工具、Doctor20/20、三平台导出与88文件迁移校验通过。前端产品代码、依赖和24迁移保持；三仓契约仍1.51.1/143操作。最终结果见[本仓证据](../validation/failure-diagnostics-20261104.json)。
