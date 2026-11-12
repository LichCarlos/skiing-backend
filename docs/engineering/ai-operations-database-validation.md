# AI 管理真实数据库验收

负责人：后端维护者。日期：2026-11-02。适用已确认 D-46 / D-47，契约保持 OpenAPI 1.49.0（142 个操作）。[AI 运维实现](ai-operations.md)与[正式会话审计契约](../../../docs/03-详细设计与接口数据/AI会话审计接口定版建议.md)继续作为实现依据。

## 环境和复现

本轮恢复 Docker Desktop 后，新建专用 `pgvector/pgvector:pg17` 容器，不连接已有项目数据库。PostgreSQL 17.11、vector 0.8.7；容器名称 `linji-ai-validation-1793583841588`，标签 `linji.task=ai-management-validation`，完整 ID `ed26852ed6417ecc629fcb4f3655c6835dc63f42bd9997232397042dd669eb8d`，`AutoRemove=true`，仅映射 loopback 随机端口 53271。数据库名 `linji_ai_validation`。测试凭证仅传进程环境，不写入 `.env`。该名称/端口仅为本次证据，复验应重新创建专用库。

在 Backend 独立目录、仅为新建隔离数据库配置 `DATABASE_URL` 和测试专用 `INITIAL_ADMIN_ACCOUNT` / `INITIAL_ADMIN_PASSWORD` 后，按顺序执行：

```powershell
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm db:seed
pnpm db:verify
pnpm test:db
pnpm db:verify
pnpm db:deploy
pnpm check
pnpm build
pnpm test:e2e
```

23 项迁移已在全新库应用，两次 seed 与初始结构校验已通过。`db:verify` 现在遍历仓库迁移目录检查全部迁移，补充人工停用/控制版本/索引代次的类型、非空/默认值、两项约束和 AI 管理权限 seed 边界。CI 主验证任务增加数据库测试后的再次校验；本地通过不代表远程 CI 已运行。

## 最终验证结果

| 命令/核验                     | 本轮最终结果                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Backend独立冻结安装           | 通过，无依赖/锁文件变更                                                                        |
| `pnpm check`                  | lint、typecheck、128文件/1017项单测通过                                                        |
| `pnpm build`、`pnpm test:e2e` | 构建通过；4文件/126项HTTP通过                                                                  |
| `pnpm test:db`                | 33文件/810项真实PostgreSQL测试通过                                                             |
| 测试前后`pnpm db:verify`      | 23项迁移、15项索引、18项约束、RAG控制列/默认值、3个内置角色及收益/AI权限边界通过               |
| 重复`pnpm db:deploy`          | No pending migrations to apply                                                                 |
| 三仓OpenAPI                   | 1.49.0，142操作，SHA-256均为`9168fb665aa3c3e494be26d1429b7a76bc3869472fc25995d27443085e0c215a` |

Web/App本轮未改变业务/API/依赖，未重跑完整检查和构建；沿用紧邻前阶段的独立冻结安装、Web完整check/双应用构建、App343项/Doctor20/20与三平台导出证据，不将其写成本轮重新执行。README配套说明已同步。

最终数据库清理核验：仅测试seed管理员1个、内置角色3个；OperationLog、Outbox、Inbox、RagDocument/Chunk、AI会话/消息、雪场、文章、项目知识、动态/评论、资产、商家、收益/幂等请求/导入任务与行均为0。首次失败与两轮完整数据库日志保留，不掩盖先前失败。已核验完整ID/名称/标签/AutoRemove并停止自建容器，自动移除已确认；其余五个容器保留。测试期间发现另有`charge-postgres-1`运行，属于其他任务/用户环境，本轮不操作；原a_signal四容器亦未停止。

## 专项覆盖

| 套件                                                    | 结果      | 真实参与部分与关键边界                                                                                                                                                            |
| ------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [会话审计](../../test/ai-conversation-audit.db-spec.ts) | 11 项通过 | Nest HTTP、真实登录、入口/独立正文授权、`user` 范围交集和冲突拒绝、稳定分页/count、访客排除、软删记录、正文按序读取、成功审计及 INSERT 失败不返回正文                             |
| [RAG 运维](../../test/rag-source-management.db-spec.ts) | 14 项通过 | Prisma/PostgreSQL 事务、现行来源资格 SQL、chunk/model 统计、内置管理员复核、停用/启用/重建、同版本竞争、三类写入审计失败回滚、generation fencing、真实 pgvector 检索及 Inbox 去重 |

会话审计日志只保存操作者/目标/原因/trace 等元数据，不复制正文或 citations。测试以数据库 `TraceId` 长度约束制造实际审计 INSERT 失败，验证仓储抛错、不返回正文且不提交成功日志；HTTP异常不泄露正文由此前的持久化替身HTTP套件验证，不能混称为本用例的真实HTTP失败注入。成功读取和授权/范围拒绝均经过真实HTTP。未提供管理员删除、恢复或导出接口。

RAG 套件使用确定性 1024 维 Embedding 替身，并直接调用事件处理器；数据库、pgvector、Inbox、Outbox、授权和事务均为真实实现。启用索引不改变雪场的 `pending_review` 等业务状态；不合格来源消费后停用且不调用 Embedding。重放同一事件不再次调用 Embedding，陈旧事件不覆盖较新的人工停用。即使故意保留 `indexed` 状态和旧 chunks，`ManualDisabled=true` 仍在检索 SQL 排序/limit 前被排除。

同内容 hash 的两个索引任务分别领取 generation；旧任务不能提交 chunks 或写失败状态。人工控制版本变化后，旧 expectedControlVersion 在领取时拒绝。重建、停用、启用三类命令都经过真实审计失败回滚测试，检查来源记录、chunks 数量、Outbox 和 OperationLog 无部分提交。

## 发现与修复

首次 RAG 专项 11/14 通过。两项夹具误用社区的 `pending` 状态，已修正为雪场既定的 `pending_review`，未修改数据库约束。另一项暴露实际并发错误：`SELECT ... FOR UPDATE` 的序列化失败由 Prisma 返回 `P2010`，真实 PostgreSQL SQLSTATE 位于 `meta.code=40001`；原逻辑只检查顶层 code，导致异常未转为领域冲突。

仓储现同时识别 Prisma `P2034`、顶层 SQLSTATE 及 `P2010.meta.code` 中的 `40001` / `40P01`，统一映射 `RagSourceConflictError`，按既定 HTTP 异常映射返回 409，要求客户端刷新后显式重试。新增六项单测覆盖冲突形态与无关 raw SQL 错误原样传播。真实同版本并发重建验证一个成功、一个冲突，仅增加一个版本、一条 Outbox 与成功审计。

会话套件调试中修正测试模块 ConfigService 装配、商家资料夹具字段与 BigInt 日志序列化断言；未放宽业务校验。最终 11 项真实 HTTP/PostgreSQL 专项通过。

## 全局雪场回归补充

首轮完整数据库回归33文件/803项中798项通过，5项失败均集中在旧全局雪场图片夹具：未授予D-45已确认的`content:asset:list`与asset all，请求在原MIME/审计/锁校验前即返回403。已为有权测试补齐独立夹具权限，同时新增缺grant、self/selected、显式再次提交及Guard后撤权拒绝用例。

继续增加部分更新回归后发现实际遗漏：应用层仅校验本次提交的关联，没有校验保留的旧图片，导致旧封面或相册变为`pending_scan`后仍可修改价格并重写关联。已改为校验合并后的最终关联，对显式提交的非空图片另行要求资产库授权；省略保留和清除不增加该授权。现有图片仍按ready/MIME/存在性校验并领取共享引用锁。新增真实HTTP用例先得到意外200，再修复至既定422；最终[全局雪场套件](../../test/admin-resort-http.db-spec.ts)34项通过，包含原有真实竞争锁/审计回滚。

本次没有新增路由、DTO/VO、依赖或migration。上述修复落实已确认的[全局雪场字段与资产契约](../../../docs/03-详细设计与接口数据/全局雪场字段与资产授权补充建议.md)，没有扩大自定义角色授权。

## 验收限制

本轮不调用真实 Embedding/对话模型，不启动 Kafka broker，也不替代浏览器登录后操作、移动设备/SecureStore、真实对象存储、生产故障/再平衡/容量演练、独立冷启动或远程 CI。授权事务保证当前快照一致性，不承诺已经开始的请求在随后撤权时自动取消。整个项目仍未完成。

日志保留在 Backend 本仓已忽略的 `ai-controls-*.log`；首次失败和最终复验分开保留。测试仅清理自身创建的数据，不变更seed共享角色。最终夹具无残留；自建容器已核验完整ID/名称/标签/AutoRemove，仅停止该容器并确认自动移除，其他容器保持原状。
