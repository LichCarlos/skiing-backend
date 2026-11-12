# 后台任务与连接资源的停机顺序

2026-11-04 当前续验：独立Linux环境完整十项真实集成全部通过、无跳过，包含35秒心跳、三分区再平衡、进程中断恢复及Nest停机排空，前后结构/数据/topic/group及服务清理均通过。见[当前证据与边界](linux-kafka-validation.md)。下方2026-11-03及更早计数、未验或失败描述保留为当时历史；Windows文件语义问题未在Windows修复，生产集群/供应商仍待验。

2026-11-03 Kafka长任务心跳续修：当前消费者已补[长任务心跳与失败排空](kafka-handler-heartbeats.md)，新增8项单测通过，真实35秒用例尚未运行；完整套件现预期10项。既有Windows失败仍未解决，下方九/八项与通过统计仅为各自历史范围。

2026-11-03 原生Kafka诊断：原生实际运行进入了HTTP/worker停机与重放流程，但随后topic删除清理引发broker日志目录失败，该项总体仍失败，不能将主体执行过程记为通过。当前完整集成1失败/8跳过，见[原生诊断](native-kafka-validation.md)。以下为历史Linux容器验收范围。

日期：2026-11-02。接续 [Kafka 恢复验收](kafka-recovery-validation.md)，处理独立 Backend 进程关闭时的在途任务一致性。无新业务接口、迁移或运行时依赖，OpenAPI 保持 1.50.0 / 143 操作。

## 实际缺口和修复

OutboxPollingWorker、RevenueRetentionWorker 原来只清除定时器，没有等待当前任务；KafkaEventPublisher 和 PrismaService 都在 onModuleDestroy 关闭连接。同模块 provider 的销毁钩子由 Nest 并发执行，仅在 worker 中增加 await 仍无法阻止共享 producer 提前断开。数据库也必须保留给在途 HTTP 请求，不能依赖模块遍历顺序。

当前顺序：

1. **onModuleDestroy**：Outbox、收益结果清理停止接单、清除定时器并等待当前 Promise；收益导入恢复沿用已有等待逻辑；Kafka consumer 停止并等待正在执行的处理器。一个 worker 的重复触发仍共用同一运行中 Promise。
2. **beforeApplicationShutdown**：所有模块的销毁钩子完成后，断开 Kafka producer；此时 Outbox 的发送与数据库确认均已结束。
3. **Nest HTTP disposal**：关闭 HTTP 服务，等待现有请求完成。
4. **onApplicationShutdown**：最后断开 Prisma，覆盖 worker 和 HTTP 请求的数据库生命周期。

Outbox 和 Kafka consumer bootstrap 也明确跳过 OPENAPI_EXPORT，避免启用了派发/消费环境变量时导出契约产生业务副作用。已停止的 worker 不再接受工作；重复 bootstrap 不再安装额外定时器。关闭时不伪造 published、completed 或成功回复；失败仍走原有租约/重试协议。

对应实现：

- [OutboxPollingWorker](../../src/modules/integration-events/infrastructure/outbox-polling.worker.ts)
- [RevenueRetentionWorker](../../src/modules/resort-management/infrastructure/revenue-retention.worker.ts)
- [KafkaEventPublisher](../../src/modules/integration-events/infrastructure/kafka-event.publisher.ts)
- [PrismaService](../../src/shared/persistence/prisma.service.ts)

直接实例化 publisher 的专项清理调用相应 beforeApplicationShutdown；业务代码不应在关闭资源钩子后继续发布。独立数据库脚本仍自行在 finally 调用 `$disconnect()`，不依赖应用容器。

## 回归与真实服务验证

新增 worker 回归先复现三项失败：Outbox 不等待发送、收益清理不等待数据库工作、契约导出时误启动派发。新增 [Nest 生命周期 e2e](../../test/shutdown.e2e-spec.ts) 使用实际 AppModule 和框架钩子，数据库/Kafka 端口为替身，先确认关闭提前返回的失败，再验证顺序修复。

[真实集成场景](../../test/worker-shutdown.integration-spec.ts) 使用实际 AppModule、HTTP 服务、PostgreSQL/pgvector、Kafka 4.1.1、Outbox polling、producer、consumer、收益清理和 RAG handler。只将外部 Embedding 替换为固定 1024 维向量；在真实发送/清理之前加可释放等待门，用于确定性地把关闭请求放到在途窗口，释放后仍调用原实现。测试内部验证路由仅存在于测试模块，不注册到产品或 OpenAPI。

场景包含：

- 首个应用以启用 Outbox、关闭 consumer 的配置启动。等待发送和收益清理已开始，同时保留一个真实 HTTP 请求；调用 app.close，验证应用、producer 和数据库均未提前关闭。
- 释放后台工作，实际 Kafka ACK 后 Outbox 为 published、Attempts=1、LockToken=null；收益清理实际查询完成。producer 此后关闭，而仍在途的 HTTP 请求可以继续使用数据库。
- 释放 HTTP 请求，真实 SQL 查询返回 1/HTTP 200；请求结束后 Prisma 才断开。
- 新建应用启用生产 consumer，靠 bootstrap 消费已经 ACK 的积压事件，没有手动派发或直接调用 handler；Embedding 进行中再次 app.close，验证数据库仍保持、关闭仍等待。释放后 Inbox completed 与单个 RAG 向量块持久化，再关闭数据库。KafkaJS 的 runner 停止后可能跳过 offset 提交，因此再次启动同组：未确认消息安全重放，最终 offset=1；Inbox 只有一条，Embedding 仍只调用一次，向量 ID/索引时间不变。

真实回归首次在第二次关闭后要求 offset=1 而超时；检查 KafkaJS 2.2.4 的 runner.commitOffsets，确认它在 running=false 时直接返回。该场景符合已有至少一次投递/Inbox 规则，修正验收为持久化效果和重启幂等，不修改生产逻辑去伪造确认。失败日志保留。

`pnpm test:integration` 纳入以上用例。没有完整容器 ID 时，上阶段 broker 停机用例仍明确跳过；其他 Kafka 和本轮真实停机用例执行。CI Kafka job 已具备专用数据库、broker 标签和完整 ID，本轮仅扩充其测试入口，远程 CI 尚未执行。

## 独立复现

本轮当前已通过：新增 worker/consumer 单测 7 项，完整单元 131 文件/1048 项；HTTP e2e 5 文件/127 项（含本轮 Nest 生命周期），Kafka/真实停机专项 2 文件/9 项，140.13 秒。后端冻结安装、lint/typecheck 和 build 通过。启用两个消息 worker 开关、并将数据库和 Kafka 都设为回环不可达端口后，编译后的 OpenAPI exporter 独立运行通过，生成的 1.50.0 / 143 操作 SHA-256 仍为 `adaa39927fab990393b5d9213cf81eebea2f500d456aa93deefa006cb79d40c0`。

初轮三仓与外部服务同时检查时出现 Backend Vitest 子进程意外退出、Web Windows 退出码 3221226505，以及第二次 seed 的 Prisma P2028 事务失效。降低同时运行的检查数量后，Backend 完整复验、双 seed 均通过。Web 后续复验明确出现 V8 `Zone Allocation failed - process out of memory`；当前机器同时有其他项目进程，保持它们不变，使用本机安装的 Vitest 4.1.2 支持的 `VITEST_MAX_WORKERS=1` 运行同一完整 check，不跳过测试或降低业务校验。各次失败日志保留；最终结果见阶段交付记录。

真实数据库完整回归 34 文件/823 项，419.01 秒；两个专用库均执行 23 项迁移、双 seed 和测试前后 db:verify。最终每库 User=1，ProjectKnowledge/RagDocument/OutboxEvent/ConsumedEvent/OperationLog 均为 0。宿主机 Kafka Admin 核对无测试 topic/group，只剩内部 `__consumer_offsets`。

三仓独立冻结安装/check/build均通过：Web1459项（本轮以单worker复验）及官网/Admin两构建缓存命中；App56文件998项、Doctor20/20及三平台导出。两个前端业务与生成类型不变，三份契约哈希一致，仍各自从本仓锁文件独立运行。

本轮 PostgreSQL 容器 `linji-worker-shutdown-db-20261102`（完整 ID `dd4d4b3d11b757af8637123e8ba5e20c02e06e3b2425bb5731bc2f9ac5371626`，回环 63021）；Kafka 容器 `linji-worker-shutdown-broker-20261102`（完整 ID `31a424489f5438038a559b3952753ff2c85bcf7058ddab48be098161d2c3e73e`，回环 63022）。两者及四个匿名卷已按完整 ID/名称/标签核验后移除；两个端口无监听，工作区外临时凭证已删除，原五个无关容器与其他项目进程保持。清理报告 `D:/linji-worker-shutdown/20261102/cleanup.json`，App 三平台导出 `D:/linji-worker-shutdown/20261102/app-export` 和各仓忽略日志 `shutdown-*.log` 保留。未提交、推送或部署。

准备独立的 Kafka 4.1.1 和 PostgreSQL 17/pgvector。两者都不能复用业务服务。为本仓注入 DATABASE_URL、INITIAL_ADMIN_ACCOUNT、INITIAL_ADMIN_PASSWORD、KAFKA_INTEGRATION_BROKERS；指定 LINJI_DATABASE_TEST_DISPOSABLE=true。

真实停机专项只接受回环数据库 `linji_shutdown_validation`，或 CI 专用 `linji_kafka_validation`。测试会启动后台恢复/清理与全库 Outbox 扫描，禁止借用开发/生产数据库。

```powershell
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm db:seed
pnpm db:verify
pnpm test:integration
pnpm db:verify
```

完整数据库回归另用独立的 `linji_password_validation`，按已有测试保护规则运行 `pnpm test:db`；不与 Kafka suite 并发修改同一库。

## 部署边界

上述真实验证通过 Nest app.close 发起，未证明操作系统信号、容器终止期限或进程强杀。生产入口已有 enableShutdownHooks；部署方须让进程接收正常终止信号，并留出后台任务、HTTP/SSE 和供应商超时所需的退出时间。

本轮不新增统一停机超时、不强行把未完成任务标成成功。SIGKILL、宿主机故障和超时强停依然依赖原 Outbox/Inbox/导入租约与重启恢复，不保证模型调用无重复。实际生产发布、浏览器/原生设备、供应商和多节点灾备仍待验收。
