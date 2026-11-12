# 项目知识事务授权与文章引用验收

后续阶段：项目知识来源读取复用发布规则，项目知识旧 v1 索引在复验回填前隐藏，防止存量内容绕过新写入校验；见 [历史知识复验](rag-legacy-project-validation.md)。人工全量语料审查及真实供应商回填仍未完成。

日期：2026-10-30。对应已确认 API-M06/M07、D-39/D-40 与项目知识输入规则。状态：代码、单测及专项真实数据库验证通过；三仓完整阶段结果以 README 最新记录为准。无新增 HTTP 路由/字段、依赖或 migration，OpenAPI 仍为 1.39.0。

## 项目知识写入

创建、编辑、发布、撤回、软删除五类命令均通过 `ProjectKnowledgeTransaction.authorize`，在各自 Serializable 事务内重读有效账号、角色、活动权限，检查管理入口与精确动作 grant，以及受保护的 system_admin 身份。角色名与不可编辑 SystemRoleCode 必须同时为 system_admin；只复制权限的自定义角色不满足该接口的既有身份限制。

账号停用、撤销管理员关联、缺少动作或入口权限，以及 system_admin 与其他有效角色混绑导致主体无效时均拒绝写入。已停用的附加角色不导致主体失效。授权规则来自 IdentityAccess 的 Principal/领域规则；Application 只依赖业务事务端口，不直接访问 Prisma。

更新仍要求客户端 version 与当前版本一致，并在数据库条件中再次检查。状态命令在事务内读取版本，保留首次 PublishTime；编辑 published 记录仍为 published，DELETE 仅写 DeletedAt。版本到达正 int4 上限时拒绝继续递增，返回 409；非法版本输入和超出正 int4 的目标 ID 为 400，不将 PostgreSQL 整数溢出暴露为 500。业务、版本、Outbox 和审计同事务。

正文之外，title、category、sourceUrl 也执行已确认的禁止疑似凭据、个人信息与可执行 HTML 内容规则。来源 URL 只接受 HTTP(S)，禁止 userinfo 凭据；对 URL 解码文本与查询参数也检查，避免编码 token 绕过。规范化 URL 超过数据库 2048 字符上限返回 400。PEM 私钥与 token/refresh_token 等疑似秘密赋值返回 422；错误不回显命中内容。

发布命令重新校验当前存储记录，旧草稿/撤回记录不能绕过新输入规则发布。规则采用保守的确定性模式识别，不等同于人工审核或对全部敏感信息的完备识别；正常的改密说明、公共文档 URL 和长篇纯文本仍允许。邮箱匹配设置长度界限，避免在允许的长正文上无界回溯。已经发布/索引的历史内容仍需专门审查，本轮未冒充全库清洗或真实模型验证。

## 文章引用与边界

沿用已实现的事务内文章主体/范围/字段策略检查。创建/编辑先锁定 knowledge.article_category 类型和对应字典项，再检查 active 与公开分类资格；非空封面先领取 Asset 共享行锁，再检查 ready 及 JPEG/PNG/WebP。阻止读取旧就绪/活动状态后，并发停用先提交而关联仍写入的问题。

PostgreSQL raw 40001/40P01 与 Prisma P2034 统一映射 409，不自动重放旧内容，其他错误保留原异常。文章目标也限制正 int4，图片 ID 限规范正十进制 bigint 字符串，不经 JS number；内部版本上限返回 409。D-39 范围和首次发布、已发布编辑规则不变。

## 真实证据与夹具修复

新增 `test/project-knowledge-http.db-spec.ts`，实际装配 Nest、DTO、bcrypt/JWT 登录、Guard、Application、Prisma、Outbox 和专用 PostgreSQL。没有替换业务仓储或数据库授权；一次性 runWrite 调度钩子只在 Guard 成功后提交账号/身份变化，再执行原始真实事务。

修复前该文件 23 项中 16 项失败：其中 15 项是管理员绑定/账号/身份、敏感元数据、ID 和版本问题；额外角色测试另有夹具缺少必填 DataScope 的错误，已修复，并移除修复过程中误加到其他对象的重复键。不放宽 schema 或期望状态码。项目知识现为 24 项通过，含五类实际审计 INSERT 失败的原子回滚、同 version 并发仅一次成功、六步生命周期的六个事件/六条审计和旧稿发布校验。

原 `knowledge-content.db-spec.ts` 的项目知识用例现用独立账号关联受保护的现有管理员角色；不再让文章普通编辑账号直接调用项目知识写入。回滚测试使用有效身份与实际超长 TraceId INSERT P2000，不用不存在账号代替数据库写失败。测试只新建/撤销本轮账号关联，不修改共享内置角色和权限。

文章新增加 7 项真实库测试；5 项边界/MIME 回归在生产修复前全部失败。图片和分类竞争测试由另一真实事务先更新并持锁，通过 pg_stat_activity 确认 FOR SHARE 等待，释放后验证 409，文章版本/正文/封面、审计与 Outbox 均未改变。异步更新结束后恢复本轮分类 fixture，失败路径亦执行恢复。知识内容文件现为 26 项，连同新增项目知识 HTTP 文件共 50 项通过。

授权单测另覆盖五个精确动作 grant、账号/角色/绑定/权限状态、入口、受保护标记、混合有效角色、未知动作和停用附加角色。文章单测补充 raw 40001/40P01 映射且不重放。全体生产 Application/Domain 的架构门禁继续通过。

## 实际边界

三仓分别 frozen install 通过；Backend lint/typecheck、118 文件/816 单测、3 文件/85 HTTP、26 文件/468 真实数据库测试及 build 通过，完整库测试前后 db:verify 通过（20 迁移）。Web check 187 项及官网/Admin production build；App check 99 项、Doctor 20/20 与 iOS/Android/Web export 通过。文档收尾另执行格式与本地链接检查。

三仓 OpenAPI 1.39.0 SHA-256 仍为 bd9f3a624ab2263966bc4e9b6a33bd677e735af94f27ff44b446b2ba5a9e9444。复用并核验专用 linji-events-validation-20261030：完整 ID 45a28641a1d2f357f3ce5c088e8f3a876433d34d43d4a8b4f76c0c09ddb7f3a2、loopback 53240、pgvector/pgvector:pg17。未写 .env、增减迁移、启停用户服务、提交/推送/发布；原 3010/3001 仍为 PID 49660/60192，验证库和 dist-events-validation 导出保留。

授权按事务快照生效，不承诺授权读取之后的撤权立即取消全部在途写入。共享引用锁只协调本次关联提交，之后仍允许合法停用。项目知识列表/详情沿用请求期 Guard 与身份检查，未改为新的统一读取授权事务；文章已有独立读取快照逻辑。

本轮没有修改 Web/Expo API 或业务页面。前端有效范围投影、页面/API 浏览器流程、真实对象存储/扫描/provider、生产恢复与压力测试仍缺。全局雪场字段/资源授权及 RAG 运维新增协议继续等待原有确认，不因本轮修复实施待定 API。
