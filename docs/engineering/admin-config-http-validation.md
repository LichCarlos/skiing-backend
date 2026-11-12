# 系统配置生产HTTP与持久核对

日期：2026-11-03。负责人：Backend。对应API-M11/ADM-21，保持契约1.51.1/143操作与24迁移。本轮后端仅修改管理HTTP验收夹具，不修改生产接口。

前端生产读取器从六项默认目录定位原本，使用实际 expectedVersion 保存名称，再以旧版本请求验证409拒绝。下一次名称保存成功后，在真实HTTP响应已到达客户端适配层时注入一次响应丢失；门禁保留待核对记录并拒绝重复提交。通过生产读取器核对版本2和实际名称，再由人工确认路径释放本地阻断。随后保存一项含HTML字面文本和换行的合成政策。

匿名GET /public/config不携带Cookie，核对七字段固定投影、最新名称/政策与revision变化。配置角色即使持有list/update grants仍被受保护管理员规则拒绝；详情式查询期间真实退出管理员会话，结束身份复核拒绝旧内容；显式重新登录后读取恢复。没有伪造/auth/me响应，也没有启动Next/Expo服务。

数据库后置核对仅有site.name和site.privacyPolicy两条业务配置，版本分别2/1、状态active、值和更新人精确匹配；名称依次0→1、1→2，政策0→1，共三条成功审计。Metadata仅包含configKey/beforeVersion/afterVersion，不含名称或政策正文。旧版本和非管理员拒绝均不增加成功审计。原业务断言继续保留，总Outbox仍53；配置保存不新增Kafka事件。

运行和日志哈希见[本仓证据](../validation/admin-config-20261103.json)，页面实现见[Web说明](../../../web/docs/engineering/admin-config-read-lifecycle.md)。使用本轮隔离PostgreSQL和编译Nest，结束后停止临时API及数据库并核对端口、PID和临时密码文件清理。

注入发生在真实服务提交后的客户端响应边界，不等于宿主机断电或生产网络故障。Node Cookie不证明浏览器/CSRF，匿名HTTP不证明官网/App渲染。本轮未执行全库数据库、Kafka、供应商、容器、签名包或远程CI验收；未启动/重启Docker。D-49/D-50/D-09保持待决，整个项目未完成。
