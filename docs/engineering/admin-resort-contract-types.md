# 全局雪场可空数值的契约类型修正

日期：2026-11-03。负责人：Backend 雪场模块。范围：既有全局雪场创建/编辑 DTO；不增加接口、业务字段、依赖或数据库迁移。

## 问题及处理

CreateAdminResortDto 的 merchantId 和 rating 使用 `number | null`。运行时装饰器元数据将这种联合类型表示为 Object，原 Swagger 声明未提供显式类型，导致导出的 OpenAPI 及 PartialType 派生的 UpdateAdminResortDto 均错误生成 `type: object`。生成客户端因此无法按数字表达实际请求。

现在 merchantId 显式声明为 integer，保留 minimum=1、nullable=true；rating 显式声明为 Number，保留 0–5、nullable=true。省略、null、数值的既有业务含义及服务端 class-validator 规则保持。此修正只调整请求 DTO 的文档元数据，不改变响应中的金额/评分字符串规则。

契约使用修订版本 **1.50.1**，仍为 **143 操作**；三个独立仓库同步 JSON 和各自生成类型/锁文件。商家资料管理 D-49 是另一项待确认协议，没有进入此次版本。

## 验证与边界

在既有真实 Nest HTTP 框架测试中新增契约回归，直接通过生产 createOpenApiDocument 构造文档，检查创建及编辑 DTO 的四个属性，以及 POST/PATCH 的请求 schema 引用。修复前因实际 type=object 失败，修复后通过，日志 merchant-profile-schema-before.log / merchant-profile-schema-after.log 保留。

完整检查、构建与三仓冻结安装结果以本阶段最终记录为准，不能把本项 OpenAPI 回归称为真实数据库、浏览器或模型供应商验收。Docker Desktop 按用户要求不重启，数据库/容器待办保留。

最终结果：本仓冻结安装、lint/typecheck、138文件1192项单测、8文件157项HTTP/框架测试、build及编译后契约导出均通过。递归对比导出前后JSON，只有版本号与四处属性type变化；无其他结构变化。Web1494业务加20发布测试/双无缓存构建，App1151项/Doctor20/20/三平台导出及各仓冻结安装通过。三份SHA-256均为 `a0470ef5bf68866240416c85f9bee40ed00467b9608aafda75d35c56feb82759`。
