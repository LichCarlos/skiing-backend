# 项目知识与 Outbox 运维持久化验证

负责人：Backend。基线：OpenAPI 1.51.1 / 143 操作、24 项迁移。沿用已定版 API-M07 / API-M11，生产代码及数据库结构保持。入口见[原生管理端 HTTP 验证](admin-authorization-http-validation.md)，证据见[本轮摘要](../validation/content-events-http-20261103.json)。

独立 Web 套件新增四项知识流程和两项事件运维场景，现共 27 项。在专用临时数据库完成 24 迁移、双 seed 和前后 db:verify，再直接核对持久状态：

- 项目知识经历创建、草稿更新、发布、发布后更新、撤回、再发布、软删除。版本 1→7，首次发布时间保持；最后正文和来源 URL 的 null 清除正确，数据库记录保留 published 且 DeletedAt 非空。
- 七条知识 Outbox 的状态依次为 draft、draft、published、published、withdrawn、published、deleted，EventType/目标 Payload 精确匹配；七条操作审计按顺序核对动作、操作者、前后版本及删除标记，审计不包含正文。
- 合成失败事件通过参数化 SQL 写入 `.123456` 微秒时间，供前端生产定位器查找。重试仍使用原 EventId，Attempts 保持 5、MaxAttempts 从 5 增到 13，AvailableAt 立即可投递，无租约、PublishedAt 为空。
- 事件 Payload、LastError 及两项原始微秒时间保持；管理响应仅暴露批准的元数据。只有一条重试成功审计，原因经 trim，前后状态/次数/预算与数据库相同。
- 全库共 13 条 Outbox，其中七条知识变更、四条既有 RAG 重建、一条雪场变更、一条原事件；Inbox 为空。原 RAG 六条控制审计、商家隔离、字段及会话审计断言保留，拒绝 trace 无成功审计。

首轮夹具给 failed 事件设置租约，触发既有 `OutboxEvent_lease_check`，准备失败；日志和已停止环境保留。修正夹具遵守约束，在全新库完成 27 项及后置核对。生产约束没有改变。

最终运行目录为 D:/linji-content-http/20261103/final/linji-admin-http-owyISh。报告 completed/stopped/serverStopped 全为 true，并核对端口关闭、postmaster.pid 与初始化密码文件缺失。前端不持有数据库/JWT 密钥，也不导入本仓代码；后端运行器不启动其他仓库。

Kafka 投递和消费者在该隔离运行中关闭，事件 pending 不代表已投递、消费或索引完成；真实供应商、浏览器/设备、容器、签名包和远程 CI 不在本轮范围。D-49、D-50、D-09 保留待确认，整体目标仍未完成。
