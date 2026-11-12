# Backend 工程实践来源

本页只记录已采用的项目规则与代码落点，不复制上游 Skill 文档。

| 来源                                                                                                                                                                                                                                                                                                    | 版本/提交                                            | 查阅日期                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------- |
| [NestJS Modular Monolith](https://www.skills.sh/tech-leads-club/agent-skills/nestjs-modular-monolith)，[上游 SKILL.md](https://github.com/tech-leads-club/agent-skills/blob/738451e40785750a8e8de5bce8112675f5f0df02/packages/skills-catalog/skills/%28development%29/nestjs-modular-monolith/SKILL.md) | `1.0.0` / `738451e40785750a8e8de5bce8112675f5f0df02` | 2026-10-27（上游提交 2026-10-26） |

## 当前落地核对（2026-11-04）

上表保留实际查阅的技能版本与日期；本次核对本仓源码和验证记录，没有重新获取或升级上游技能。当前契约为 OpenAPI 1.51.1 / 143 操作，24 项迁移。以下替代早期“仓储尚未过滤范围”“登录限流/数据库尚未实现”等状态描述。

| 实践               | 当前代码与证据                                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DDD 模块化单体     | 业务上下文位于 src/modules；Domain 规则、Application 用例/端口、Infrastructure 适配器及 Presentation DTO/Controller 分离。[AST 门禁](../../test/architecture/all-context-boundaries.spec.ts)约束内层和跨上下文导入；应用层仍有限使用 Nest DI/异常，边界见[DDD 说明](ddd-boundary-validation.md)。                                                                    |
| 认证与当前授权     | [主体读取器](../../src/modules/identity-access/infrastructure/prisma-authorization-principal-reader.ts)从数据库读取账号、有效角色和权限；[授权规则](../../src/modules/identity-access/domain/authorization.ts)合并显式 grants。短效 JWT、refresh 哈希/轮换/重用撤销、Cookie/CSRF、原生 refresh transport 及[共享登录限流](login-rate-limit.md)均有实现。             |
| 数据范围与字段权限 | user/role/resort/article/asset 已接资源目录和各仓储过滤；同资源多角色范围冲突拒绝。[角色范围](role-scope-authorization.md)、[雪场范围](global-resort-scope.md)、[文章字段](article-field-authorization.md)、[资产范围](global-asset-scope.md)分别说明具体语义。商家身份由账号关联的业务资料及授权组合决定，不按 RoleKey=merchant 硬编码识别；seed 提供商家授权模板。 |
| 事务与异步一致性   | 业务写入按各用例使用事务、唯一约束和幂等键；审计/Outbox 与业务变更同事务，Kafka 消费用 Inbox 去重。真实消息链和失败恢复见[三类来源验证](multi-source-kafka-rag.md)，不宣称端到端 exactly-once。                                                                                                                                                                      |
| pgvector RAG       | [RAG 授权规则](../../src/modules/ai-assistant/domain/rag-access.ts)及[回答用例](../../src/modules/ai-assistant/application/rag-answer.service.ts)限制来源、版本与公开投影，无可用来源时拒答；检索后再核对可见性。真实 BGE-M3/DeepSeek 与可验证引用的范围见[真实 RAG 验收](real-rag-validation.md)。                                                                  |
| 资产与恢复         | [本人资产读删](owned-asset-access.md)重建当前授权并保护五类引用；[上传事务](asset-upload-authorization.md)在建档/ready 提交检查授权。[数据库恢复](database-backup-restore.md)和[数据库/S3 只读核验](storage-recovery-verification.md)分别有独立入口与边界。                                                                                                          |
| 独立交付           | schema、迁移、seed 与 OpenAPI 由本仓维护；[源码导出](source-export.md)不带父目录依赖或密钥。前端各自锁定契约并生成类型，经 HTTP 调用，本仓不导入前端源码。                                                                                                                                                                                                           |

## 验证范围与待办

当前全业务数据库回归见[本轮说明](full-database-regression.md)；三仓冻结安装、lint/typecheck、单测、构建或导出的来源副本见[工程证据](../validation/owned-asset-access-20261104.json)。具体命令和替身边界以各专项为准；旧日期的环境失败与测试数量保留在相应工程说明中。

这些落点不等于所有生产条件已完成。浏览器/原生设备、签名包、生产模型容量与业务语料、长期索引、TLS/监控/联合灾备、容器及远程 CI 仍待验；D-49/D-50/D-09 保持待决。上游技能只提供实践依据，业务契约与用户已确认规则决定项目行为。
