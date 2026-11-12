# App AI 真实 HTTP 与 pgvector 验收

2026-11-02，配套App既定AI会话契约续验。Backend产品代码、OpenAPI1.50.0/143操作与23项migration未变；新增仅本仓合成HTTP provider/夹具脚本，未让App导入Backend代码或连接数据库。

本轮三仓冻结安装通过；Backend完整130文件1039项、lint/typecheck及Nest build通过。一次性pgvector/pg17库23迁移/双seed和前后db:verify通过；编译后 `node dist/main.js` 真实运行。App独立3项HTTP/SSE测试及下述持久断言通过，未重跑历史完整数据库/HTTP套件。

## 夹具边界

[ai-mobile-http-fixture.ts](../../scripts/ai-mobile-http-fixture.ts) 只接受回环数据库 `linji_ai_mobile_validation` 和同名显式确认标记。serve 要求只有seed管理员、无雪场/RAG/会话，创建公开/草稿/管理员可见三个雪场及其1024维向量，真实写入pgvector。每个来源使用当前sourceState，不绕过检索来源一致性。

合成provider固定回环62912端口、要求测试Bearer key和 `ai-mobile-fixture` 模型标记，只提供 `/v1/embeddings` 与 `/v1/chat/completions`。返回确定性向量/SSE回答，模型请求断言提示词含公开雪场且不含草稿/受限标题。正常Backend仍使用自己的OpenAI-compatible HTTP适配器，不替换应用服务或检索仓储。调用次数写本仓忽略的storage文件，仅作验收断言，不是正式产品遥测。

## 独立复现

先创建本轮自己的 PostgreSQL17/pgvector 容器与空库，不复用已有数据；DATABASE_URL必须指向回环专用库。按本仓README冻结安装、db:generate、check/build，设置合成 INITIAL_ADMIN_ACCOUNT/PASSWORD，执行db:deploy、两次db:seed及db:verify。然后配置：

```powershell
$env:AI_MOBILE_FIXTURE_CONFIRM='linji_ai_mobile_validation'
pnpm exec tsx scripts/ai-mobile-http-fixture.ts serve
```

该进程保持合成provider运行，夹具JSON在本仓 `storage/ai-mobile-http-fixture.json`。另一个终端保留专用DATABASE_URL并设置：

```powershell
$env:PORT='62910'
$env:JWT_ACCESS_SECRET='<至少32字符的临时随机值>'
$env:OUTBOX_DISPATCH_ENABLED='false'
$env:KAFKA_CONSUMER_ENABLED='false'
$env:EMBEDDING_BASE_URL='http://127.0.0.1:62912/v1'
$env:CHAT_MODEL_BASE_URL='http://127.0.0.1:62912/v1'
$env:EMBEDDING_API_KEY='ai-mobile-synthetic-provider-key'
$env:CHAT_MODEL_API_KEY='ai-mobile-synthetic-provider-key'
$env:EMBEDDING_MODEL='ai-mobile-fixture'
$env:CHAT_MODEL_NAME='ai-mobile-fixture'
node dist/main.js
```

向独立App测试提供上述API地址及合成夹具JSON，执行其 `pnpm test:ai-http`。三个测试按顺序执行，注册两个合成账号；第一个流的completed在真实提交后被客户端测试截断，再显式重试同一幂等键。然后切换账号、同账号重新登录并软删除本人会话。

完成后在本仓核验：

```powershell
pnpm exec tsx scripts/ai-mobile-http-fixture.ts verify
pnpm db:verify
```

verify同样要求专用DATABASE_URL/确认标记；db:verify还需seed使用的INITIAL_ADMIN_ACCOUNT/PASSWORD。断言两个账号各一轮user/assistant，恰好两个会话/一次软删除；重试没有追加消息；所有assistant引用仅公开雪场，prompt检查两次，Embedding与对话HTTP调用各两次。最后停止本轮API/provider并销毁自己的容器/数据卷；失败或重复运行需重新创建一次性空库，不能对业务库清表。

## 证据与限制

本轮 `ai-mobile-database.log`、`ai-mobile-provider.log`、`ai-mobile-server.log`、`ai-mobile-database-post.log`、`ai-mobile-final-check.log`为本地忽略日志，storage清单/计数不随仓发布。App持有自己的3项测试文件及配置；Backend脚本不导入前端。本地provider是外部模型替身，不能视为DeepSeek或Embedding供应商验收。Native SecureStore、真机交互、Kafka、真实存储和生产恢复均未在本轮运行。

本轮API/provider进程已停止，专用数据库容器及其数据卷已移除，62910/62911/62912端口无监听；原有无关容器保持运行。
