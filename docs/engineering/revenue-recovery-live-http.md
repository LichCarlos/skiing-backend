# 收益恢复真实 HTTP 验证

日期：2026-11-03。负责人：后端维护者。使用现有 API-R03/R04，契约仍为 1.51.1 / 143 操作、24 项迁移。入口为 `pnpm test:native-revenue-http`，Web 客户端独立执行 `pnpm test:revenue-recovery-http`。

后端入口在显式配置的 Windows PostgreSQL 运行时与输出目录中创建专用 `linji_revenue_recovery_validation` 数据库，执行迁移、两次 seed 和前后校验；创建两家合成商家和一个自定义角色。账号、收益、请求结果、导入任务及逐行审计均使用真实 PostgreSQL，API 使用编译后的 Nest。凭证仅通过子进程环境传递，不写入就绪清单；夹具再次检查当前数据库名称及 loopback 地址。

专用环境保持 NODE_ENV=test，Kafka 与定时 worker 不启动。仅此收益套件接受输出目录中的 UUID 控制标记，每个 token 只执行一次，最多 20 次；控制只能触发固定夹具的 recover 命令，不能指定任意程序、SQL 或任务。命令直接执行原 `RevenueImportService.recover()` 和 Prisma 仓储，每次保留原先最多 25 行的批次行为。它验证生产应用处理逻辑与持久化，不证明定时调度、Kafka 投递、Inbox、租约过期或 broker 恢复。

Web 使用生产 Cookie API 客户端、单条 RevenueRecovery 和 CSV RevenueImportRecovery；仅 Cookie jar 与本机恢复存储使用 Node 测试适配。单条 PUT/CSV POST 的“响应丢失”发生在真实请求成功返回后，由客户端包装器主动丢弃结果；不伪造服务端成功、不绕过事务。原键/原 DTO/原文件恢复后核对真实结果，旧键重放不得覆盖后来金额。

CSV 验证 UTF-8 BOM、中文逗号备注、批内重复、无效雪场及部分成功；再次提交相同文件/键复用同一任务，异内容冲突。另提交 26 行，首个恢复批次确认 25 行已提交，再经真实授权 API 撤销写 grant：任务读取先返回 403，下一批按当前授权拒绝剩余行；恢复 grant 后核对 25 成功/1 失败。其他账号不能读取任务或原单条请求，商家收益查询仍只返回本人雪场。

后置核对精确检查 2 条幂等请求、2 个任务/30 行结果、28 条收益、29 条收益写审计、2 条导入创建审计；Outbox 仅 2 条 jobId 元数据且保持 pending，没有 RAG 来源或 Inbox 消费记录。所有会话退出，临时 HTTP/PostgreSQL 关闭后再探测端口。结果和日志摘要见[本轮证据](../validation/revenue-recovery-http-20261103.json)。

同轮另行回归既有 42 项管理真实 HTTP；两套使用不同数据库和服务实例，不能合称一个事务或一个数据快照。真实浏览器的 sessionStorage/IndexedDB、Cookie/Secure/CORS、React 页面、设备、Kafka、供应商、容器及远程 CI 仍需独立验收。D-49/D-50/D-09 不在本轮修改范围。
