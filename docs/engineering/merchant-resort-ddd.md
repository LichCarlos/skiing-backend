# 商家雪场与收益的 DDD 分层

> 收益后续验收（2026-10-29）：新增23项真实HTTP/CSV/PostgreSQL，完整数据库212项通过，收益写入已升级Serializable并修复并发审计/输入边界，见 [收益验收](revenue-validation.md)。下文未跑等表述保留为当时历史，浏览器/API仍待验。

> 2026-10-29 后续数据库复验：商家真实 PostgreSQL 4 项已通过，涵盖范围交集、归属/引用、状态/收益审计。 19 个迁移、两次 seed 和结构复验亦通过。下文旧“未跑”描述保留为当时阶段记录，当前验证范围以 [数据库验收](database-validation.md) 为准。

负责人：后端接口负责人。状态：代码与替身测试已验证，真实数据库与页面联调待验。查阅及实施日期：2026-10-29。

## 代码职责

| 层                     | 实际落点                                                                                                          | 职责                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Presentation           | `presentation/http/merchant-resorts.controller.ts`、`revenue.controller.ts` 及 DTO/VO                             | HTTP 校验、Guard 认证主体和 resort 范围、审计上下文、响应协议                     |
| Application            | `application/merchant-resort-service.ts`、`revenue-service.ts`                                                    | 用例授权检查、字段策略、输入校验、状态转换编排、CSV 逐行导入、结果投影            |
| Application 端口与模型 | `application/ports/merchant-resort-repository.ts`、`revenue-repository.ts`、对应 models                           | 持久化无关的查询、写入命令、事务能力和结果；不暴露 Prisma 类型或 HTTP DTO         |
| Domain                 | `domain/merchant-resort.ts`、`resort-management-scope.ts`                                                         | 纯 TypeScript 的生命周期、字段授权合并、分页与范围规则，不依赖 Nest/Prisma        |
| Infrastructure         | `infrastructure/prisma-merchant-resort.repository.ts`、`prisma-revenue.repository.ts`、`merchant-resort-scope.ts` | Prisma、Decimal/BigInt 映射、WHERE 交集、关系校验、事务、操作审计和 Outbox 持久化 |
| 装配                   | `resort-management.module.ts`                                                                                     | 把业务仓储 token 绑定到 Prisma 适配器                                             |

商家雪场和收益 Application 已移除 Prisma、共享数据库服务、HTTP DTO 及 Infrastructure 导入。模型以字符串表达精确坐标/评分/金额/Asset ID，不把 ORM 对象交给用例。应用服务保留 Nest DI 与异常适配；跨上下文只通过 AssetStorage、CustomFieldRepository 应用端口及字段领域规则协作。CSV 解析仍使用 csv-parse，不参与领域依赖。

## 业务和事务边界

所有已确认 D-38 范围语义保持：self/merchant/selected/all 均与本人有效商家归属取交集，selected 禁止创建；动作权限仍由 Guard 检查。Application 在访问端口前再次拒绝缺失/非法范围；Prisma 适配器将范围写入数据库 WHERE，selected 与目标 ID 分别保留，不被客户端目标覆盖。

`MerchantResortRepository.runWrite` 暴露业务事务接口，不暴露 Prisma delegate。应用层编排 active 账号/商家复核、关系校验、写入、事件和审计；适配器保证这些调用共用一个 Serializable 事务。图片 ready/owner 和标签/字典类型 active 在写事务内校验，已删除/未授权目标不写入；版本冲突和 P2034 保持 409，不自动重试旧预读。签名 URL 在事务提交后生成，事务回调内没有对象存储、Kafka publish 或模型调用。

更新只替换显式提供的相册和标签，省略保留、空数组清空；仍校验最终保留的引用。审核提交后的详情在事务内读取，响应投影在提交后执行。审计仅记录必要 before/after 与变更字段名，状态、关系、Outbox 和 OperationLog 原子提交；Outbox 投递仍为事务后独立工作，保持 at-least-once。

商家雪场列表/count 和收益明细/count 使用 RepeatableRead 快照；收益汇总、按日分组和指定雪场名称也在同一个 RepeatableRead 事务内查询，避免单请求内各项数据来自不同快照。管理员收益 upsert 及其审计仍在同一写事务内；CSV 每一行调用一次该原子命令，保留部分成功与重复日期拒绝规则。金额在持久化边界用 Decimal 处理，前后端仍只传 decimal 字符串。

本次未新增路由、请求字段、依赖或 migration；OpenAPI 保持 1.28.0，SHA-256 `61ede5b5214de4f47c1631b12ce5735384fed0fe1c26ac8d3a4c1f43db7c0c4e`。前端不消费仓储代码，继续在各自仓库生成客户端类型。

## 验证与未完成项

- 原 Prisma 参数/事务测试移至 Infrastructure，继续覆盖 D-38、字段策略、Outbox、审计与冲突映射。增加收益真实适配器编排测试，验证唯一键、Decimal 和审计失败传播；替身测试不证明数据库回滚。
- 新 Application 测试直接使用业务端口替身，覆盖范围先拒绝、并发版本失败无事件/审计、published 编辑回审核、显式清空/省略保留关系、事务后签名、重复审核、收益范围/精度、日期/金额校验和 CSV 部分失败。
- `test/architecture/merchant-resort-boundaries.spec.ts` 通过 TypeScript AST 检查静态/类型/动态导入，现已扩大到 ResortManagement 全部 Application/模型/端口，防止重新导入持久化、HTTP DTO 或 Infrastructure；Domain 继续禁止框架依赖。
- Backend `pnpm check` 91 文件 / 434 项通过；HTTP e2e 2 文件 / 63 项通过；Nest build 与 OpenAPI 导出通过。三仓 frozen install、Web check/双应用构建亦通过；App SDK 补丁复验记录见交付记录。
- `test/merchant-resort-scope.db-spec.ts` 四项真实 PostgreSQL 用例已改用实际仓储装配并通过 lint/typecheck，仍因已知数据库环境不可用而未执行；远程 CI 未运行。不能用 mock 证明事务回滚、隔离级别和并发安全。

后续增量已拆分 AdminResortService 和 PublicResortService 的业务端口/Prisma 适配器，并把公开排序分页下推数据库，见 [全局与公开雪场 DDD](global-public-resort-ddd.md)。上方 434 项为本阶段历史基线，最新验证见该说明。字段 schema/有效角色读取仍通过请求期端口，写事务内尚未重新解析完整 RBAC；并发撤权、动态 schema 变更一致性、跨上下文引用公开端口、浏览器/API、对象存储/Kafka/provider 和设备联调仍待实施或验证。全平台其他上下文也须逐一审计。
