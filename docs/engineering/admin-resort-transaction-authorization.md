# 全局雪场写事务授权与引用校验

2026-11-02 续验：D-45字段/资产授权已实施，旧夹具补齐asset读取grant与all范围。新增真实HTTP回归发现并修复部分更新遗漏保留图片校验：最终合并关联仍领取共享锁并校验ready/MIME，显式提交非空图片另需asset全局授权，省略/清除不新增该授权。全局雪场34项真实数据库专项通过；23项migration与AI专项证据见[数据库验收](ai-operations-database-validation.md)。下文2026-10-30缺口/计数为历史记录，浏览器和真实存储仍待验。

日期：2026-10-30。对应已确认 API-M05 全局接口。没有新增 HTTP 路由、字段、依赖或 migration；OpenAPI 保持 1.39.0。全局动态字段授权与资源授权仍有下述缺口，本阶段不将全局管理标为全部完成。

## 写入授权

创建、编辑、软删除、发布、下架五类写命令均通过应用事务端口 `AdminResortTransaction.authorize`，在各自 Serializable 事务内重新解析当前账号、有效角色、活动权限、管理入口和动作对应的 `resort` 范围。只有当前范围仍为 all 才继续；无授权、账号/角色失效、撤销角色关联、范围收窄及有效角色范围冲突均返回 403。

授权依据 grants，不要求固定商家角色、商家资料或 system_admin 身份。自定义角色具有全局动作权限与 all 范围时仍可工作；商家路由另按业务归属约束。请求 Guard 和 Application 原有七类入口的 all 检查保留，body/query 不能提供可信授权上下文。

业务数据、相册/标签关系、Outbox、成功审计继续在同一事务保存；更新保留 UpdateTime 条件。管理员编辑已发布记录保持 published，发布、下架与软删除仍按原状态机执行。签名 URL 在事务成功之后生成。

## 引用与输入

引用非空 MerchantId 时先领取 MerchantProfile 共享行锁，再检查商家资料与所属账号 active。封面/相册按去重 AssetId 排序领取共享行锁，再检查 ready 与 JPEG/PNG/WebP MIME；普通文本、SVG、GIF 等不能作为雪场图片。标签先锁定 resort.fit_tag 类型，再按 ItemId 顺序锁定涉及字典项，并检查类型与项目均 active。

若并发修改方先持锁并提交，旧快照请求返回 409，不把旧状态下的关联写入。P2034 与 raw P2010 中 PostgreSQL 40001/40P01 统一映射 409，不自动重放旧表单。其他数据库异常继续抛出，不用并发错误掩盖。

正 int4 目标 ID 在读取前校验；merchantId、price、ratingCount 不得超过 int4。price 原 DTO 上限仍为 400，其余应用层越界为 422；目标 ID 为 400。图片 ID 使用共享领域校验：规范正十进制字符串、无前导零、不得超过 bigint 上限，不转为 JS number。共享分页领域规则继续限制安全整数与 int4 offset。

## 真实数据库证据

新增 `test/admin-resort-http.db-spec.ts`，真实装配 Nest/DTO、登录、bcrypt、JWT、Guard、Application、Prisma、Outbox 与专用 PostgreSQL。仅外部存储签名 URL 使用固定适配器。通过 runWrite 的一次性调度钩子，在真实 Guard 成功后提交权限变更，再调用原始仓储；不替换真实授权查询或业务写入。

修正测试夹具后，生产修复前的 22 项针对性测试中 19 项失败：五类动作撤权、六类主体/角色/入口/范围变化、三类 MIME、bigint 溢出、两类目标 ID 与两类整数溢出。原有 price DTO 拒绝及两类非规范图片 ID 已能拒绝。首轮夹具曾误用被服务端忽略的 x-trace-id 请求头触发审计错误，现改由真实应用用例传入超长审计 trace，并验证 PostgreSQL INSERT 的 P2000 回滚；不将该夹具错误算作生产回归。

修复后的新增文件 27 项通过：包括三种实际引用锁竞争，通过 pg_stat_activity 确认 FOR SHARE 等待后释放持锁事务，验证 409、无业务/关系/审计/事件副作用；审计 INSERT 失败使价格、封面、相册和 Outbox 全部回滚；合法自定义全局角色的五步生命周期产生五个事件和五条审计。原三项范围测试改用独立真实角色/grants，审计回滚使用有效账号和真实 INSERT 失败，不修改共享内置角色权限。

## 验收与剩余工作

三仓分别 `pnpm install --frozen-lockfile` 通过。Backend lint/typecheck、117 文件/791 单测、3 文件/85 HTTP 测试、25 文件/437 真实数据库测试与 build 通过；数据库测试前后 db:verify 均通过。Web check 共 187 项及官网/Admin production build 通过；App check 共 99 项、Doctor 20/20 与 iOS/Android/Web export 通过。仅文档收尾后补格式/链接检查，不重复执行无关业务测试。

OpenAPI 1.39.0 三仓 SHA-256 均为 bd9f3a624ab2263966bc4e9b6a33bd677e735af94f27ff44b446b2ba5a9e9444。专用库为 linji-events-validation-20261030，完整 ID 45a28641a1d2f357f3ce5c088e8f3a876433d34d43d4a8b4f76c0c09ddb7f3a2，loopback 53240，pgvector/pgvector:pg17；20 迁移。没有写 .env、迁移开发库、启停生产服务或删除验证容器，未提交/推送/发布。原有 3010/3001 仍为 PID 49660/60192，App 导出保留在 dist-events-validation。

保证限于写事务授权快照；在该快照读取之后发生的撤权不保证立即取消在途事务。共享引用锁协调本次关联提交，不禁止后续合法停用；公开查询和 RAG 仍须按当前来源规则过滤。列表/详情仍沿用请求期 Guard，未统一到新的写事务授权流程。

全局雪场动态字段目前仍在事务外读取 schema，并将活动定义视为全部可读/可写；尚未落实自定义角色字段策略，属于已确认需求的实现缺口。需补事务内定义/字段策略/选项快照、响应 CanRead 过滤、仅校验实际提交键并保留省略历史值，以及管理表单的有效字段目录。全局资源关联还需落实契约“具备全局资源权限”与资产列表 grant/asset all 的组合检查；本阶段的 ready/MIME/锁校验不替代资源授权。

本段为2026-10-30阶段边界：当时浏览器/API、存储/provider、负载与生产恢复尚未验收，未实施未定版API。RAG来源运维后续已获确认并实施，现行协议和证据见[AI运维说明](ai-operations.md)；真实私有存储证据见[MinIO验收](minio-source-storage.md)，未完成项以README当前记录为准。
