# 商家雪场生命周期真实 HTTP 验证

日期：2026-11-03。负责人：Backend。沿用 OpenAPI 1.51.1 / 143 操作和 24 项迁移，本轮后端仅改动联调夹具。最终结果见[本仓证据](../validation/resort-reads-20261103.json)。

运行方式沿用[管理授权 HTTP 验证](admin-authorization-http-validation.md)。独立临时 PostgreSQL/pgvector 执行迁移、双次 seed、数据库核对，随后启动编译 Nest；Web 用生产 HTTP/表单/命令模块访问实际接口。凭证随机生成，仅通过环境传入。不启动 Next、Expo、Docker 或 Docker 的 WSL 发行版。

可配置业务角色与当前账号商家关联提供管理能力，不硬编码 merchant 角色。新雪场由商家创建为 draft，再提交 pending_review；管理员 publish 后公开可读。商家编辑 published 资料直接转 pending_review，原公开详情 404；复审发布后显示新介绍，管理员 offline 后再次隐藏，商家可以重新提交审核，最后在本人范围软删除。另一商家的读取和更新均 404。真实详情响应后实际撤权，客户端结束身份复核拒绝交付。

后置核对共三条物理雪场行：原有两家业务资料保持；新建行具有 DeletedAt，商家归属、名称、更新后介绍、票价 188、最终 pending_review、空相册/标签/封面及扩展字段均匹配。该雪场八条 resort.changed.v1 事件均为 pending，逐条核对 resortId、merchantId 和状态，状态集合对应 create、两次送审、两次发布、编辑复审、下架、删除；八条成功审计按动作核对业务账号或管理员。全套 Outbox 从前一阶段 22 条增加到 30 条，既有文章/分类/RAG/项目知识及收益断言保留。

此验证不执行 Kafka/Inbox/定时器，不请求真实模型、Embedding 或 S3；不计实际浏览器、设备和容器验收。D-50 尚未确认的审核原因协议不在本轮范围，D-49 商家资料生命周期和 D-09 账号删除保持待办。全部临时服务必须停止并核对端口，失败日志保留。
