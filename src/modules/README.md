# NestJS 模块边界

2026-11-02：所有九个业务上下文的 Domain/Application 现有 AST 依赖门禁，覆盖40个领域与118个应用生产文件。系统配置邮箱校验已改为端口/适配器，领域不直接依赖class-validator。详见[DDD检查与边界](../../docs/engineering/ddd-boundary-validation.md)；静态依赖通过不代表聚合、并发授权、Infrastructure协作或真实平台验收已全部完成，下方旧联调状态按历史记录阅读。

NestJS 是按 DDD 限界上下文组织的模块化单体。每个上下文使用 Nest Module 作为装配边界，业务代码按需建立以下最小分层：

```text
<context>/
  domain/          # 实体、值对象、领域规则、仓储端口；不依赖 NestJS/Prisma/Kafka
  application/     # 用例、事务编排、输入输出端口
  infrastructure/  # Prisma、Kafka、模型服务和文件存储的适配器
  presentation/    # HTTP Controller、DTO、Guard 与序列化
```

不要从其他上下文直接导入其 Repository、Prisma Model 或领域实体；跨上下文使用公开应用端口/只读查询契约，异步副作用通过 Outbox 和版本化 Kafka 事件。IdentityAccess 已有认证/RBAC/账号管理，ResortManagement、Community、KnowledgeContent、MemberEngagement 和 PlatformAdministration 已有不同程度业务 API。AiAssistant 已接授权检索、五种来源 Outbox/Kafka handler 与会话/消息 HTTP/SSE 用例；IntegrationEvents 提供发布与 Inbox 幂等执行。模块存在不代表完整业务交付；真实 PostgreSQL/Kafka/provider 联调和部分管理接口仍缺，具体以接口矩阵为准。

IdentityAccess 已建立注册、登录、刷新、退出和当前用户 HTTP 路由；注册事务通过不可变 `SystemRoleCode=registered_user` 查询基础角色，不依赖可编辑的 RoleKey。D-16/D-18 输入规范、短效 JWT、refresh 哈希轮换/重放撤销和 Web Cookie/Origin/CSRF 均已实现并有测试。真实 PostgreSQL migration/并发集成及登录限流尚未验收；客户端已有认证页面但真实 API/设备验收仍缺。授权快照及角色/账号管理已有实现，仍需逐接口验证数据范围与数据库事务；不得仅凭种子模板宣称完整 RBAC 已完成。
