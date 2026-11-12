# AI 审计存储引用声明（D-52）

2026-11-03 用户已确认修正。OpenAPI 补丁版本 1.51.1，143 个操作，三仓同字节快照 SHA-256：`e5570e24af7bf5670cda3914591924f3c0d4321248c01ce0e7d2a95bd34745a8`。

`AiConversationAuditMessageVO.citations` 返回 Prisma 可空 Json 的历史值；原来的 nullable object 注解生成了空对象类型，无法表示合法引用数组。现在用 OpenAPI 3.0 anyOf 声明五个 nullable 分支：允许任意附加属性的 object、任意元素的 array、string、number、boolean。顶层没有 object 类型约束；citations 仍是必填响应属性，其值允许 null。

结构化差异检查只允许 `/info/version` 和该 citations 属性变化。路由、动作权限、数据范围、原因、访问审计、事务、持久化与实际返回逻辑保持；没有新增 migration、密钥或供应商调用。Web、App 分别在本仓生成客户端类型，不引入跨仓代码依赖。

现有审计 HTTP 套件新增七项回归：检查实际生成 Schema 和版本、数组/嵌套对象/字符串/数字/布尔值/null 原样返回。测试使用真实 Nest 路由、Guard、DTO 与响应中间件，替换持久化端口，不能代替真实 PostgreSQL 事务验收。Web 解析器直接使用生成类型，保留历史 JSON 的复制/白名单，不再覆盖 citations 为本端 unknown。App 同步类型；App 本身没有新增管理员审计页面。

本轮结果见[验证摘要](../validation/rag-source-lifecycle-20261103.json)。此前会话审计真实 HTTP 和数据库证据保留为历史记录，本次没有将其重新计数。

App 的 openapi-typescript 7.13.0 原样生成多个 nullable 分支，TypeScript 将其正确合并为包含 null 的联合；Oxlint 会报告重复 null。仅在自动生成的 `src/platform/api/openapi.ts` 上关闭 `typescript/no-duplicate-type-constituents` 一条规则，不手工改生成代码，也不关闭业务源码、其他规则、TypeScript 或契约生成一致性检查。
