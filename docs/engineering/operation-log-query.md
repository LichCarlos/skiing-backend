# 操作日志只读查询

2026-10-29，D-42 已由用户确认。GET /api/v1/admin/operation-logs 已接入 PlatformAdministrationModule。接口只读既有日志，不提供详情、导出、写入或删除。

## 契约与边界

管理入口、system:operation-log:list 与有效 system_admin 身份必须同时满足。Guard 每请求加载当前账号授权；Controller 独立拒绝自定义角色。旧 JWT 不携带授权快照，已提交撤权后下次请求返回403。

| 参数                              | 规则                                               |
| --------------------------------- | -------------------------------------------------- |
| page / pageSize                   | 默认1/20，pageSize 1–100；offset 限 PostgreSQL Int |
| actorUserId                       | 正整数，不超过2147483647                           |
| actionKey / resourceKey / traceId | 可选完整值匹配，最长150/100/100                    |
| result                            | success / failure                                  |
| fromTime / toTime                 | 带时区 ISO 时间，闭区间；起始不可晚于结束          |

未知参数拒绝。响应为 items/total/page/pageSize/hasNext；每项只有 operationLogId（十进制字符串）、actorUserId（可空）、actorAccountSnapshot、actionKey、resourceKey、targetType、targetId、result、traceId、createdAt（UTC ISO）。不查询也不返回 Reason、Metadata、ClientIp、UserAgent，不读取用户实时详情代替账号快照；账号被移除后仍保留快照。

Domain 定义纯读模型，Application 注入 OperationLogReader、校验数值/时间范围并二次白名单投影，Prisma 适配器仅 select 允许列。列表与 count 共用 where 和 RepeatableRead 快照，以 CreateTime DESC、OperationLogId DESC 稳定排序；BigInt 直接转字符串。Controller 承担 DTO 和 HTTP 授权，数据库只由后端访问。无新依赖或 migration，OpenAPI 1.31.0。

## 验收

新增10项快速测试覆盖投影、数值/时间拒绝和角色限制。真实日志HTTP/PostgreSQL17项覆盖生产登录/JWT/Guard/Controller/Prisma、管理员/普通用户/自定义角色、日志与入口撤权、精确筛选/闭区间/同时间稳定分页/count/空页、参数与未知字段、nullable actor、超安全整数ID、敏感列不返回及无写入/详情/导出路由。

专用容器 linji-operation-log-validation-20261029，完整ID 7b66335893493b9196dc20e4ce79389af581b5251d176013909d9b57860a87ca，pgvector/pgvector:pg17，loopback随机端口62123。19迁移、两次seed、测试前后db:verify、完整数据库12文件/95项通过。独立复验须重建专用库，不复用历史端口，不对开发/生产数据库执行。

首轮HTTP套件5项仍断言历史OpenAPI1.29.0而失败；随后更新为当前1.31.0，保留具体schema断言，并补日志只读schema/筛选字段验收。Web首轮3项只因Ant Design双汉字间距导致SSR断言失败；修正为兼容空格的文案断言。

## 未完成项

配置白名单和API、Outbox查询/重试、AI管理仍缺协议或实现。字段/字段分组配置写入目前缺原子OperationLog覆盖；读取面板不会弥补写审计缺口。本阶段不宣称已覆盖所有管理变更。

真实浏览器点击/API成功态、日志大数据量性能与保留策略仍未验；本轮不重跑Kafka/ClamAV/provider/MinIO。全项目未完成。Web接入、独立检查与交互限制见本仓README及Web仓自己的日志说明。

本阶段完整验收：Backend check110文件/638项、HTTP3文件/80项、build/OpenAPI通过；Web check115项与官网/Admin build通过；App check64项、Doctor20/20与三平台export通过。三仓frozen install通过，契约1.31.0哈希一致。核对完整ID/名称/任务标签/AutoRemove后停止本次专用容器，确认自动移除；其他项目容器和用户服务未改动。
