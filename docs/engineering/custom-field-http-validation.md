# 字段与分组真实 HTTP 续验

日期：2026-11-03。负责人：Backend。OpenAPI 1.51.1 / 143 操作、24 项迁移保持；本轮修改联调夹具，生产业务代码保持。验证日志与源码摘要见[本仓证据](../validation/field-reads-20261103.json)。

`pnpm test:native-admin-http` 启动隔离 PostgreSQL，部署迁移、执行两次 seed 和数据库基线核对，再启动编译 Nest；客户端运行独立 Web 仓库的 `pnpm test:admin-authorization-http`。随机临时凭证只通过进程环境传入，不写入报告。客户端完成后，后端夹具核对持久化结果，停止 Node/PostgreSQL 并清理临时密码文件。需要提供原生 PostgreSQL 运行目录与隔离输出路径，执行方式沿用[管理授权 HTTP 说明](admin-authorization-http-validation.md)。

新增场景使用文章实体的专用分组及 `single_select` 字段，引用已启用的 `resort.fit_tag` 字典类型与 `http_root` 默认值。验证字段创建版本 1、编辑版本 2、旧版本编辑 409、启用版本 3、分组停用保护 409、字段软停用版本 4，随后修改并停用分组。成功响应经过前端生产 VO/回执解析器。

另给现有业务账号绑定可配置的 `system:field:list` 权限，在字段数据返回之后通过真实授权接口撤销该权限。生产读取器结束时复核身份，拒绝把该次结果发布给页面；不依赖硬编码商家角色。

后置核对检查字段 ID、实体、键、标签、默认值、字典类型、私有标记、最终版本 4 和 disabled 状态；分组标签、排序 5 及 disabled 状态；字段四条、分组三条成功审计及其管理员账号快照。原有权限目录、账号、商家隔离、收益、RAG 和事件断言继续运行。

本轮不计 Kafka 投递、Inbox、供应商、对象存储、真实浏览器或容器验收。Docker 和其 WSL 发行版不启动、不重启。D-49、D-50、D-09 保持未实施；整个项目尚未完成。
