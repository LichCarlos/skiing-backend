# 业务闭环工程说明

2026-11-05 收尾：五项闭环实现已交付。Backend1494单测/177框架HTTP/865真实DB、8项真实服务场景通过；Web3062业务测试及双生产构建通过；App1238测试、三平台导出及4项Android实操通过。完整浏览器、iOS/真机与新增依赖真实Kafka仍待验；构建和API测试不代替完整三端点击验收。 详见[本轮报告](../validation/business-closure-20261105.json)。

日期：2026-11-05。独立仓库当前契约 OpenAPI **1.52.0 / 151 操作**，SHA-256 `4b15275231f7d421b80210b769c2d1cc0d1bc704ec73ce3c5d4839c827e9c84d`。

商家资料由身份模块管理，新增公开业务查询与AI受限计划执行，索引sourceState v2/依赖fanout和两类清理命令均已接入。25个迁移含资料版本、索引原因、资产checkpoint和JSONB索引。

## 协议与状态

商家资料由受保护system_admin和独立grant管理，不隐式配置角色；修改/启停带expectedVersion和必填原因，冲突409。动态字段写入拒绝未知/越权键；公开目录只返回活动分组中的IsPublic字段，字典还需公开活动。

`GET /catalog/:entity/fields`、`POST /catalog/:entity/query` 只支持ski_resort/article/dynamic，组合AND筛选、白名单排序及偏移分页，同快照COUNT；管理和私有数据不可查询。浏览器POST执行Origin/CSRF。AI使用同一查询端口，模型只输出受限计划，服务端渲染实际结果与条件；不支持自由SQL或私有报表。

索引公共字段快照升级为v2，来源/字典/字段/作者依赖通过Outbox/Inbox分批更新，旧索引即时失效。部署后需用后端rag:reindex回填，不能仅升级schema。固定原因码取代供应商错误正文。

## 运维与验证

后端可用 `pnpm maintenance:rag -- --help` / `pnpm maintenance:assets -- --help`；默认预览、--apply才修改，每批最多500、年龄至少24小时，游标继续扫描。资产锁后复读最新引用，退役后才删除S3，checkpoint支持重试；RAG清正文和向量、递增generation并从权威来源重入队。

测试、失败和目标平台限制以[本轮报告](../validation/business-closure-20261105.json)为准。当前不以构建、HTTP或模型验证代替浏览器/Android/iOS完整点击验收。过去2026-11-04报告只证明其当时源码。未提交、推送、发布；不启动/重启Docker，不重试此前被自动审批拒绝的Next生产服务和Expo Web启动。
