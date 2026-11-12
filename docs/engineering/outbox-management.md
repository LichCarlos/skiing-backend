# D-05 Outbox 运维

2026-11-01，当前契约 OpenAPI 1.46.0。本功能在 IntegrationEvents 模块内实现，无新依赖或 migration。下文首版协议沿用；本轮只新增时间精度数据库回归用例，生产代码未变。

## 分层与权限

`presentation/http/outbox-events.controller.ts` 提供查询 DTO、重试 DTO、元数据 VO 和 HTTP 路由；`application/manage-outbox-events.ts` 负责输入边界、白名单投影与业务错误映射，通过 `OutboxManagementRepository` 端口访问数据。`domain/outbox-management.ts` 是纯 TypeScript 的状态/预算规则；`infrastructure/prisma-outbox-management.repository.ts` 实现查询和事务，不把 Prisma 类型引入内层。

`GET /admin/events` 要求有效 `system_admin`、`management:portal:enter`、`system:event:list`；`POST /admin/events/:id/retry` 的动作权限为 `system:event:retry`。无管理员身份的自定义角色即使有全部动作 grant 仍拒绝。菜单 `/admin/system/events` 和两个动作权限由同源 seed 维护；部署后执行幂等 seed，不允许只更新客户端就假定角色已获新权限。

## 查询与重试

查询使用 page/pageSize（1–100），校验 int4 偏移上限。status、eventType、aggregateType、aggregateId 完整匹配；fromTime/toTime 为含时区 ISO 时间，按 CreatedAt 闭区间筛选。列表/count 同一 RepeatableRead 快照，排序 CreatedAt DESC、EventId DESC。

数据库 select 和应用返回均采用显式白名单，仅包含事件身份、类型、聚合、状态、累计次数/上限及时间。不会查询 Payload、LastError 或 LockToken。响应的锁信息只有 LockedAt 时间，不含令牌。

重试 reason trim 后1–500字，仅 failed→pending；其他状态和 int4 预算溢出409，缺失404，非法参数400。保持 EventId、Payload、Attempts，MaxAttempts 增加8，AvailableAt 设为当前时间，清空 LockedAt/LockToken；内部 LastError 保留到后续投递成功。Serializable 事务内复核活动账号、独占的技术管理员角色和活动动作/入口 grant，再条件更新并写 OperationLog；并发序列化失败映射409。原因、计数前后快照与状态在同事务提交，审计失败全部回滚。

审计资源键 `outbox-event`、动作 `system:event:retry`、目标 `OutboxEvent`；不存消息正文和锁令牌。原 EventId 延续 Inbox 幂等，已 completed 的消费不会因管理重试重复执行。流程仍是至少一次投递，未提供强制重复消费命令或 exactly-once 保证。

## 验证与复现

本轮 `test/outbox-management.db-spec.ts` 共25项通过。新增真实微秒时间用例：仅对本套件新建事件将CreatedAt设为`.123456Z`，经真实HTTP返回`.123Z`；等值ISO筛选结果为空，从该毫秒到下一毫秒的闭区间能返回原EventId及唯一分页结果。用例finally只清理自身事件。Web恢复查询以该窗口结合不可变聚合元数据和精确ID匹配，未新增详情端点或扩大公开数据投影。微秒精度只影响定位，重试仍由原Serializable事务判定；客户端预读不提供原版本条件或持久幂等。

在已迁移且两次 seed 的专用 PostgreSQL/pgvector 库中设置进程环境 DATABASE_URL、INITIAL_ADMIN_ACCOUNT、INITIAL_ADMIN_PASSWORD，再执行：

```powershell
pnpm install --frozen-lockfile
pnpm db:deploy
pnpm db:seed
pnpm db:seed
pnpm db:verify
pnpm check
pnpm test:e2e
pnpm test:db
pnpm db:verify
pnpm db:deploy
pnpm openapi:generate
```

新增 `test/outbox-management.db-spec.ts` 24项真实 HTTP/PostgreSQL 测试：匿名/普通/自定义角色拒绝、旧JWT撤权、同条件分页/count/时间边界/排序、元数据投影、无效参数、重试状态及预算、事务内权限复核、真实审计INSERT失败回滚、原投递Store和completed Inbox衔接。并发测试先取得真实行锁，观察两条请求均在 pg_stat_activity 等锁后释放，确认200/409和单条审计。业务仓储、认证与数据库均为真实实现；此套件不启动Kafka或模型服务。

新增9项单测覆盖应用层二次裁剪、错误映射、预算边界和持久层select。首次数据库夹具错误地为failed写租约，被数据库CHECK拒绝；已按现有约束修正夹具。首轮类型检查发现测试辅助参数和mock签名不完整，修正后复验。浏览器点击、真实broker/生产worker恢复、生产发布不属于本次数据库测试证据；历史Kafka集成记录独立保留。

## 收尾环境

2026-11-01 本轮收尾：三仓冻结安装，Backend942单测/97 HTTP/31文件747真实数据库及build、前后db:verify（20迁移）通过；Web1308项与官网/Admin构建，App342项/Doctor20/20/三平台导出通过。专项事件25项中新增微秒定位用例；生产授权、重试事务及OpenAPI1.46.0均未改动。测试后仅原active管理员，文章/动态/评论/操作日志/RAG均为0，四项账号权限active，原pending Outbox保留。日志event-pages-及App导出保留，未提交/推送/部署。下面为2026-10-30首版历史环境记录。

收尾核对：68份Markdown、310条本地链接无坏链，三仓契约SHA-256均为ef55c41b2cb71e7ee30530c8e81eda31cf954bc63cdbb85cff02fd5097568892。自动审批拒绝了临时导出目录和数据库容器的清理命令（仅返回blocked by policy），命令未执行；保留 app/dist-events-validation/ 和运行中的 linji-events-validation-20261030（127.0.0.1:53240，完整ID 45a28641a1d2f357f3ce5c088e8f3a876433d34d43d4a8b4f76c0c09ddb7f3a2）。未尝试绕过。只读复核确认官网3010/PID49660、Admin3001/PID60192和其他四个项目容器保持运行；未提交或推送代码。
