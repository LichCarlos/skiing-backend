# Kafka 长任务心跳与失败排空

2026-11-04 当前续验：独立Linux环境完整十项真实集成全部通过、无跳过，包含35秒心跳、三分区再平衡、进程中断恢复及Nest停机排空，前后结构/数据/topic/group及服务清理均通过。见[当前证据与边界](linux-kafka-validation.md)。下方2026-11-03及更早计数、未验或失败描述保留为当时历史；Windows文件语义问题未在Windows修复，生产集群/供应商仍待验。

2026-11-03，负责人 Backend。生产消费者内部修复，OpenAPI 1.51.1 / 143 操作、24项迁移、事件信封、权限和业务数据规则保持，无新依赖。

此前 `eachMessage` 对七个处理器执行 `Promise.all`，没有在处理过程中调用传入的 heartbeat。Embedding 或收益导入持续时间超过 KafkaJS 默认30秒 sessionTimeout 时，消费者可能失去组成员身份；其中一个处理器抛错，Promise.all还会在其他已启动任务完成前返回，重试或停机可能与旧任务重叠。Inbox唯一约束与租约仍是最终一致性保护，但不能代替消费者管理自己的在途任务。

现在每条消息将处理器调用分别包装并使用 allSettled，等待所有已启动任务。等待时每秒检查一次进度并串行调用 KafkaJS heartbeat，由 KafkaJS 自身的默认3秒 heartbeatInterval控制实际网络心跳，不重叠请求。即使其他处理器已失败，剩余工作结束前仍发送心跳。心跳失败后不再继续尝试本轮心跳，先等待所有处理器完成再向 KafkaJS传播错误；任何处理器或心跳失败均不提交该消息的offset。成功后再核对一次心跳，随后按原逻辑提交offset+1。

计时器在工作提前完成、失败或心跳开始前清理；不使用后台常驻interval。同步抛错也被包装成各自的失败结果，其他已启动任务不会被放弃。Kafka consumer stop继续通过KafkaJS等待eachMessage完成；Nest的producer与Prisma关闭顺序保持。失败排空不回滚已完成的业务事务，重放继续依靠已有Inbox和领域幂等，不能承诺端到端exactly-once。

新增8项消费者回归：35秒工作持续心跳且不提前提交、慢心跳不重叠且先排空、处理器失败等待兄弟任务、心跳失败先等待全部任务、快速成功的最终心跳校验、同步抛错、快速结束清理计时器、非法信封不启动处理器或心跳。修改前13项中7项失败、6项通过；修复后13项全部通过。原断言保留，合法消息夹具补齐KafkaJS真实传入的heartbeat、pause和完整record字段，并以EachMessagePayload直接标注，移除强制类型断言。前两次完整类型检查暴露了旧夹具的缺失字段，日志保留；补齐后专用类型检查通过。

真实Kafka集成新增一个35秒Embedding等待用例：不提高默认sessionTimeout，逐秒核对组仍Stable且memberId保持，offset和Inbox在效果完成前不确认，释放后只有一次Embedding/一组索引。现完整套件包含10项（含既有真实停机恢复），测试和生产publisher/consumer/Inbox/RAG共用既有实现。该用例已在2026-11-04独立Linux broker完整十项中通过，见页首当前证据；fake timers单测与真实broker结果分开记载。

CI的独立Linux Kafka job保留原服务及恢复控制，增加JSON/JUnit结果和专用broker日志归档，成功或失败均尝试上传14天证据。诊断收集失败不改变测试退出码；归档配置已落盘，远程CI尚未执行。日志不收集环境变量或数据库连接配置。

本机只读Docker版本探测返回引擎管道不存在，未启动或重启Docker。仅有docker-desktop WSL发行版，未借用。上次Windows原生Kafka在topic删除时发生AccessDenied并关闭日志目录，完整集成未通过；没有重复运行同一失败路径、修改删除断言、跳过用例或将历史Linux结果算成本轮成功。现有详细诊断见[Windows原生Kafka记录](native-kafka-validation.md)，当前报告见[本轮证据](../validation/kafka-handler-heartbeats-20261103.json)。

依据安装的KafkaJS2.2.4 `consumer/runner.js` 和 `consumer/index.js`核对，eachMessage自带的heartbeat只在回调外执行，长任务应自行调用；sessionTimeout默认30000ms、heartbeatInterval默认3000ms。资料：[KafkaJS消费说明](https://kafka.js.org/docs/consuming)，查阅日期2026-11-03。修复不解决CPU阻塞事件循环、供应商永久不返回、网络分区、磁盘失败或多broker选主；真实供应商、容器/远程CI及整体项目验收仍待完成。
