# 九个业务上下文的 DDD 内层依赖检查

日期：2026-11-02。接续既有社区、知识、雪场、收藏和 AI 的分层工作，本阶段补齐整个 Backend 的 Domain/Application 依赖门禁，并修复系统配置规则对外部校验库的直接依赖。没有新增 HTTP 字段、路由、运行时依赖、数据库字段或迁移；契约仍为 OpenAPI 1.50.0 / 143 操作。

## 已修复的问题

PlatformAdministration 的 `domain/system-config.ts` 原来直接导入 class-validator 的 isEmail。其他五个上下文的架构测试没有覆盖这个目录，因此此前完整测试通过也不能证明所有 Domain 都与框架隔离。

现在 Domain 声明纯 TypeScript 的 ContactEmailValidator 接口，normalizeConfigValue 显式要求该策略；键白名单、trim、Unicode 长度、拒绝邮箱策略结果和版本规则仍由 Domain 执行。Application 定义 DI token，Infrastructure 的 ContactEmailValidatorAdapter 沿用原来的 isEmail 调用。生产模块把同一个适配器绑定到管理用例和 Prisma 仓储，后者保留直接调用时的独立输入校验。

写入时拒绝非法邮箱，公开/管理读取对无效遗留值降级为默认/null，同时保留版本供修复。expectedVersion、事务内身份授权、Serializable 写入和同事务审计的原实现保持。没有使用简化正则替代原邮箱语义，也不将未知格式当作有效数据。

实现：

- [Domain 规则和接口](../../src/modules/platform-administration/domain/system-config.ts)
- [Application 端口](../../src/modules/platform-administration/application/ports/contact-email-validator.ts)与[用例](../../src/modules/platform-administration/application/manage-system-config.ts)
- [邮箱适配器](../../src/modules/platform-administration/infrastructure/contact-email-validator.adapter.ts)、[仓储](../../src/modules/platform-administration/infrastructure/prisma-system-config.repository.ts)和[生产模块装配](../../src/modules/platform-administration/platform-administration.module.ts)

## 门禁覆盖与共享契约

[全上下文 AST 检查](../../test/architecture/all-context-boundaries.spec.ts) 自动发现业务上下文，覆盖以下生产文件，不把 spec 文件计入内层代码数量。health 只提供 HTTP 存活投影，没有独立业务 Domain/Application，不列入九个上下文。

| 上下文                 | Domain 文件 | Application 文件 |
| ---------------------- | ----------: | ---------------: |
| AiAssistant            |           6 |               22 |
| Assets                 |           2 |                7 |
| Community              |           1 |               10 |
| IdentityAccess         |          11 |               27 |
| IntegrationEvents      |           2 |                7 |
| KnowledgeContent       |           4 |                8 |
| MemberEngagement       |           1 |                2 |
| PlatformAdministration |           9 |               18 |
| ResortManagement       |           4 |               17 |
| 合计                   |          40 |              118 |

Domain 只允许本上下文规则和显式列出的既有共享领域契约；拒绝外部包、Application、HTTP、数据库、Kafka/S3/模型适配器。Application 只允许本上下文用例/端口/规则、明确的跨上下文端口或共享规则，以及各上下文当前使用的有限 Nest DI/异常、Node crypto、配置或 CSV 工具。Nest DI/异常仍存在于应用层，不宣称应用层也是无框架代码。

共享白名单逐文件列出：IdentityAccess 的授权/范围/权限/资源目录，IntegrationEvents 的事件/Inbox 契约，Assets 签名存储端口，以及 PlatformAdministration 的动态字段校验/端口。它们是已有的只读规则或接口；门禁没有允许整个其他上下文的目录，更没有允许跨上下文 Infrastructure 或 Prisma 实体。未来新增依赖须审查契约和责任，再更新白名单。

检查使用 TypeScript AST，处理静态导入、再导出、import type、动态 import、require 和 import equals，并拒绝计算导入。解析器自检覆盖这些形式；原有五个上下文的更具体检查继续执行。新测试不是仅搜索某个禁用字符串。

首轮 19 项中 18 项通过，PlatformAdministration 报告框架依赖和既有 authorization-resources 依赖。核对后者为授权资源常量契约，将其纳入显式共享清单；前者通过上述端口/适配器实际移出 Domain。失败记录保留为 ddd-boundary-before.log。

## 验证与边界

系统配置及全上下文专项 4 文件 / 51 项通过：包括 Unicode/长度、策略拒绝、正常写入时原版本与审计参数、旧值降级，以及邮箱适配器的普通/国际化域名和非法地址样本。原有邮箱非法样本移到真实适配器测试；Domain 测试使用显式策略替身，只证明规则会执行策略。

[模块装配专项](../../test/system-config-wiring.e2e-spec.ts) 3 项通过，装配实际 PlatformAdministrationModule；数据库/仓储为替身。它验证生产 token 绑定、用例和仓储直接写入都拒绝非法邮箱，以及遗留值降级仍保留版本。它不调用真实数据库，也不代表 HTTP/PostgreSQL 或浏览器测试。

首轮完整类型检查发现新增测试夹具遗漏可空的 clientIp/userAgent，已补齐为 null，保留生产审计类型约束；失败日志 ddd-boundary-check.log 保留。后端冻结安装、lint/typecheck、133 文件 / 1078 单测、6 文件 / 130 HTTP/框架测试及 build 全部通过。编译后的 OpenAPI exporter 在两个消息开关启用且数据库/Kafka 不可达的环境下通过，生成文件 SHA-256 仍为 `adaa39927fab990393b5d9213cf81eebea2f500d456aa93deefa006cb79d40c0`。

当前 Docker 引擎有界查询仍超时，用户已明确选择暂不重启、保留容器验收待办，因此本阶段不能重跑真实 PostgreSQL 系统配置专项；既有 823 项数据库验证属于修复前历史证据，不能记成本次通过。容器镜像、OS 信号与真实数据库复验仍待环境恢复。见[容器发布现状](container-release.md)。没有重启 Docker、结束其他项目进程或修改运行中业务数据。

三仓配套复验按仓顺序执行，均使用各自锁文件冻结安装。Web 完整 check 的 1459 项、格式检查及官网/Admin 构建通过；两个构建命中 Turbo 缓存，本次没有新的无缓存构建证据。App 完整 check 56 文件 / 998 项、lint/typecheck、Doctor 20/20 及 iOS/Android/Web 导出通过，产物保留在 `D:/linji-ddd-boundary/20261102/app-export`。日志在各仓的 ddd-boundary-install/check/build/export.log；仅对应仓存在适用的 build 或 export 文件。Web/App 无业务修改，仅维护本轮说明和日志忽略。这些工程检查不代替实际浏览器/设备测试。

这些检查证明生产内层文件的声明依赖满足当前边界；不证明所有聚合设计、Infrastructure 间的协作、事务并发、运行时动态行为、全域授权或所有跨上下文实体都已完成最终审查。实际数据库、浏览器/设备、模型供应商、生产发布与恢复仍需要各自证据，整体目标尚未完成。
