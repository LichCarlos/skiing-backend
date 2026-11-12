# 收益读写与CSV任务恢复

2026-11-03 收益恢复联调：当前补齐独立Web生产模型真实HTTP及精确持久核对，见[本轮说明](revenue-recovery-live-http.md)；不替代Kafka或浏览器验收。下方既有版本与数量为历史。

负责人：后端维护者。状态：2026-11-01 已实施；lint/typecheck/build、977单测、97 HTTP e2e、778真实PostgreSQL用例及migration 22前后db:verify通过。基线为用户已确认的[收益恢复协议](../../../docs/03-详细设计与接口数据/收益写入核对与导入幂等定版建议.md)。浏览器/生产故障验收仍未完成。

## 管理员读取

`GET /admin/revenue`独立使用`revenue:system:list`和管理入口，以`resort`解析数据范围。只接受all/selected，self/merchant/未知/冲突拒绝。角色可配置，无商家技术角色判断；不隐式限定MerchantId。现有商家接口仍按本人归属与范围交集读取。

应用层校验有效日历、最长367天闭区间及int4分页偏移。无日期时不限日期，可仅传一端。仓储在同一个RepeatableRead事务重新读取主体/入口/范围，雪场可见性、列表及count共用过滤；范围外、缺失或已软删的指定雪场404。未指定雪场时，只返回未软删雪场的收益。

## 持久幂等

`PUT /admin/revenue`必填UUID `Idempotency-Key`，接口大小写统一为小写。`RevenueWriteRequest`主键为账号/操作/UUID，金额Decimal两位、日期及trim后的note形成SHA-256；省略/null/空白note同义。首次写入的金额、审计及完整成功VO在同一个Serializable事务提交。重放从JSON快照返回原VO，不重新写金额、更新时间或审计，不查询当前收益代替旧结果。

事务内先复核原写授权，再尝试账号/操作/键对应的PostgreSQL事务级advisory锁。使用try-lock，不等待同键请求；冲突返回409，`details[].code=REVENUE_REQUEST_IN_PROGRESS`。数据库唯一约束竞争也保守返回该码，客户端应查询/等待。摘要不一致为`REVENUE_REQUEST_MISMATCH`，过期为`REVENUE_REQUEST_EXPIRED`。不同键竞争同一雪场/日期仍由Serializable事务阻止过期before审计，序列化失败返回409，不自动重放金额。

`GET /admin/revenue/requests/:requestId`只查当前actor、原操作和键，重新复核当前入口/原写grant；不需要只读grant。RepeatableRead快照返回已提交结果，固定投影排除note、请求正文和录入人。跨账号/未提交/缺失404；404不能证明请求没有执行。结果过期410，旧键写入仍409。

## 保留与运行

结果保留30天，过期判定在读/写路径强制执行，与清理是否及时无关。`RevenueRetentionWorker`启动及每60秒最多清除500条已过期JSON结果，保留账号/操作/键/摘要/时间。单实例不重叠，失败只记脱敏错误并等待下次；多实例重复清理安全。shutdown只释放自身定时器，测试和OpenAPI导出跳过worker。数据库中无actor级联删除，以免删除账号后遗失不可复用标记；账号ID不可复用。

大批量过期积压会分批清除；需要监控过期且Result非空记录量、数据库容量和worker错误。当前没有自动删tombstone或保证恰好过期瞬间物理清除；永久键增长须纳入容量规划。各API的授权保证以各自事务快照为边界，前端预读不能替代服务端授权或提供跨请求租约。

## 验收与后续

真实HTTP/PostgreSQL覆盖原响应重放、后续更新不覆盖、note归一化、异内容、UUID、账号隔离、撤权、在途锁、过期/清理、真实审计失败回滚、all/selected读取、范围冲突、Guard后撤权、日期/偏移边界；worker单测覆盖启动/周期、关闭、测试/导出跳过和失败恢复。迁移及新增只读grant由db:verify核验。

## CSV持久任务

`POST /admin/revenue/import`现要求`Idempotency-Key: UUID`，先验证UTF-8/BOM、固定表头、10 MiB及5000行上限，再以原始文件字节SHA-256绑定账号与幂等键。相同账号/键/文件复用原任务；内容不同时409；并发唯一键竞争后重新授权并读取已提交任务，只有找不到已提交任务时才返回在途冲突。

`RevenueImportJob`和`RevenueImportRow`由migration 22建立。任务、逐行输入、文件摘要和仅携带`jobId`的Outbox消息在同一事务提交；不把CSV正文放入Outbox/Kafka。Outbox至少一次投递由Inbox幂等，worker以任务租约/锁token领取，过期租约可恢复，基础设施失败有退避和有限重试。进程启动与周期扫描均可找回到期任务。

每行在独立Serializable事务内重新检查当前账号/角色/入口/写grant及雪场引用，完成唯一业务键upsert、OperationLog、行结果与计数更新。失败行可与成功行并存；重启跳过已提交终态行，不重复写金额/审计。撤权会停止后续有效写入并记录脱敏失败；任务结束状态不表示已提交成功行回滚。终态输入7天清除，脱敏结果30天清除，幂等标记保留以阻止旧键重用。

新增`GET /admin/revenue/imports/:jobId`仅允许原actor且当前管理入口/写grant仍有效查询。首期没有跨账号列表、取消、CSV下载或人工改状态。本轮真实数据库套件在专用PostgreSQL通过；前后db:verify确认22个migration、pgvector/HNSW及关键索引/约束。测试后保留原管理员和一条既有pending Outbox，RevenueImportJob/RevenueWriteRequest/RevenueRecord/OperationLog均无夹具残留。单测和数据库套件不替代多进程broker重平衡、生产容量/告警、真实浏览器API流程与故障演练。
