# 对话与 Embedding 适配器的传输及取消

日期：2026-11-02。范围为既有 OpenAI-compatible HTTP 适配器，不新增供应商、模型 API、依赖或数据库迁移；OpenAPI 和客户端 SSE 的 delta/completed 协议保持。DeepSeek 预期模型 ID 仍须由实际供应商账号确认，本轮不调用付费模型。

## 修复

[对话适配器](../../src/modules/ai-assistant/infrastructure/openai-compatible-chat-model.provider.ts)此前在流式读取结束时只 releaseLock，遇到 `[DONE]` 后供应商继续保持响应、上层停止消费或解析失败时，没有取消响应体。先新增三项取消测试，完成、主动停止、解析错误均失败；日志 model-transport-before.log 保留。

现在所有流式退出路径在 finally 中取消 reader，再释放锁；取消失败不会掩盖原错误。既有 fetch 请求信号仍合并调用方取消和整次模型超时，超时涵盖响应头之后的 body 读取。本轮修复不承诺上游供应商停止计费，只保证本端取消读取/连接，供应商行为需单独核对。

SSE 读取支持 LF、CRLF、CR 和跨网络分片的 CRLF/UTF-8，使用严格 UTF-8 解码。单条 SSE 记录（包括尚未结束的行、注释、多行 data）上限为 1,048,576 个 JavaScript 字符单元，防止无分隔内容持续堆积；这不是模型 token 限制，也不改变现有应用层 100,000 字符回复上限。JSON 必须为对象并包含 choices 数组；空 choices 可作为 usage 元数据，delta.content 仅接受字符串/null/省略。明确错误事件、非法 JSON/结构、超大记录、无 `[DONE]` 截断均失败，不将部分内容保存为完整回答。

[Embedding 适配器](../../src/modules/ai-assistant/infrastructure/openai-compatible-embedding.provider.ts)显式检查顶层和每项对象，保留 batch index 排序、完整性及 1024 个有限数值的向量规则。非法 JSON 统一映射到脱敏错误，避免 JSON.parse 的原始内容片段进入上层日志。[HTTP 公用错误处理](../../src/modules/ai-assistant/infrastructure/openai-compatible-http.ts)在非 2xx 时取消响应体，只报告 HTTP 状态，不读取或记录供应商原始错误正文。

Chat/Embedding 均将 fetch redirect 设为 error，避免 307/308 重放提示词、来源数据和凭证；部署时必须直接配置最终 API 地址。原本地自建 HTTP endpoint 仍可用；生产网络与 TLS 由部署环境保证。适配器不自动重试请求，现有消息幂等、租约、失败状态和重试流程保持。

## 验证范围

单测覆盖响应体 cancel、三类 SSE 换行/逐字节 UTF-8、非法编码、未知结构、超大记录与 Embedding 非法信封。应用层专项把真实 Chat 适配器接入 AiConversationService，供应商 body 为替身，验证超过应用输出上限时不 complete、仍标记原 attempt 失败并关闭 body；数据库/检索不在该测试范围。

[实际 HTTP 专项](../../src/modules/ai-assistant/infrastructure/model-provider-http.spec.ts)使用真实 Node fetch、随机回环端口和真实适配器，测试自己的 HTTP 服务：

- `[DONE]` 后保持连接时只返回确认片段并关闭上游；主动 iterator.return 和调用方 abort 也关闭实际连接。
- 响应头之后 stalled SSE/Embedding JSON 被超时取消；预先 abort 不发请求。
- Chat/Embedding 重定向目标不收到重放请求，HTTP 503 未结束正文被关闭且正文不外泄；每次调用只发一次请求。
- 缺少 `[DONE]` 的流失败；Embedding 响应顺序正确且保留 1024 维。

本地服务模拟供应商协议，不证明 DeepSeek/Embedding 厂商、实际网络代理、计费、TLS、限额或吞吐可用。它也不调用 Nest HTTP/pgvector/真实数据库。此前真实 RAG HTTP/pgvector 结果保持各自历史范围，不能扩展为本轮供应商验收。

日志前缀 model-transport- 保留初轮失败与当前验证；本仓完整结果在本说明同步。Docker 按用户决定不重启，真实数据库/容器、浏览器/设备、供应商及生产恢复继续待验。整体项目尚未完成。

本轮 Backend 冻结安装、lint/typecheck、136 文件 / 1145 单测、6 文件 / 130 HTTP与框架测试及 build 全部通过。四文件专项首次 53 项通过，随后追加 Embedding 头后超时场景并随完整回归通过，现为 54 项，其中真实回环 HTTP 12 项。编译后 OpenAPI exporter 在数据库/Kafka 不可达且消息开关启用时通过，契约仍 1.50.0 / 143 操作，SHA-256 为 `adaa39927fab990393b5d9213cf81eebea2f500d456aa93deefa006cb79d40c0`。日志 model-transport-install/check/e2e/build/openapi.log。本次未重跑真实数据库、Kafka 或厂商服务。

Web 配套独立冻结安装、1459 项完整 check 及官网/Admin 构建通过（两个构建命中缓存）；前端没有业务/协议变更。实际浏览器验证仍待完成。

App 配套独立冻结安装通过；首轮 check 的 998 项测试通过，但 Doctor 因 exp.host 联网超时为 18/20。完整重跑后 56 文件 / 998 项、lint/typecheck 和 Doctor 20/20 通过，三平台导出退出码 0，产物 `D:/linji-model-transport/20261102/app-export`。初轮失败和复验/导出日志均保留，没有禁用检查或改动前端业务。
