# RAG 历史数据回填 CLI 的真实验收

日期：2026-11-04。实际执行正式 scripts/rag-reindex.ts 子进程，8项通过、零跳过、11次CLI调用。PostgreSQL17.11/pgvector0.8.1及本地BGE-M3均为真实服务；19次真实Embedding，另明确注入一次503检验失败恢复，没有调用DeepSeek或其他对话模型。生产src、schema、24迁移、依赖及OpenAPI1.51.1/143操作保持。

## 场景

| ID  | 验证内容                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B01 | --help和非法来源在数据库/模型配置不可用时仍先完成帮助或拒绝，不创建Inbox、不调用模型                                                                         |
| B02 | all模式以batch-size=1分页扫描12条合成记录；五类公开来源生成7个索引，包括公开文章分类字典；草稿雪场/文章/项目、pending动态和私有字典不进入Embedding           |
| B03 | 重复全量扫描不调用Embedding、不替换chunk，Inbox使用新的回放UUID完成；这不是Kafka事件重复投递测试                                                             |
| B04 | 模拟缺sourceState且内容哈希为旧值的索引，当前SQL先全部排除；CLI重新读取权威源并恢复7个索引                                                                   |
| B05 | 项目来源第二条注入一次503，进程退出1且只报告第一条检查点；第三条未处理，失败文档为failed；--after-id使用最后成功ID后重新处理失败行及第三条，不自动重试供应商 |
| B06 | 首次Embedding期间新增项目，当前扫描受开始时最大ID限制；下一次扫描拾取新增记录                                                                                |
| B07 | 回填不能覆盖ManualDisabled或ControlVersion，已修改的人工停用雪场也不调用模型或进入检索                                                                       |
| B08 | 文章撤回、动态转pending、字典祖先停用后回填停用4个索引并删除其chunks；没有伪造Outbox或业务审计                                                               |

成功转发的每个向量均核对1024维、有限数值和L2归一化。正式Prisma检索器用于验证当前公开资格；未创建HTTP页面服务或Kafka，未用固定向量代替模型。503是测试网关的显式故障注入，不能说供应商实际故障。测试直接在专用库写合成夹具，不替代业务HTTP审核/发布链路；后者见[五类消息链验收](five-source-kafka-rag.md)。

## 独立复现

入口为本仓 test/rag-backfill.live-spec.ts / vitest.config.rag-backfill-live.ts。仅接受回环数据库名linji_rag_backfill_validation，必须是独立空库，先完成db:deploy、两次db:seed及db:verify；初始只允许1个seed账号，业务表、索引、字典项、Inbox和Outbox为空。使用已配置CLS/L2的真实本地BGE-M3 OpenAI-compatible Embedding地址、API key和模型ID；输出目录须为仓库外的绝对路径。不能指向业务数据库。

    # 在本仓目录，数据库/Embedding配置由本地测试环境安全注入
    $env:LINJI_RAG_BACKFILL_CONFIRM='linji_rag_backfill_validation'
    $env:LINJI_RAG_BACKFILL_OUTPUT='D:/validation/backfill-results'
    $env:NODE_OPTIONS='--max-old-space-size=1536'
    $env:VITEST_MAX_WORKERS='1'
    pnpm test:rag-backfill-live

该入口会写入合成数据，故意留下本轮记录供外层隔离环境核对/清理；不会自行删除业务库，也不会启动PG/模型。测试网关只在随机回环端口转发Embedding；最终关闭网关并断开Prisma。--help/非法参数测试要求本仓无.env文件，防止CLI从其中加载真实配置；冻结导出的源码副本满足这一条件。

本次外层原生验收脚本位于D:/linji-rag-backfill/20261104/native.mjs，使用新mkdtemp集群、随机密码和随机回环端口，执行迁移/双seed/前后db:verify；成功后清空本轮合成业务/索引/Inbox，保留seed管理员与两类内置字典，停止PG及模型。最终全部业务计数为零，原始日志和冻结副本保留在同目录。脚本没有启动/重启Docker、使用Docker WSL或操作其他项目服务。

## 运维恢复规则

正式回填命令和来源策略见[实时校验与存量回填](rag-source-visibility.md)。发生失败时，使用stdout最后成功输出的source/lastProcessedId；按同一source续跑，不能把失败ID作为after-id，否则会跳过失败行。all模式不能用单一ID恢复全部类型，应先续跑失败类型，再单独执行其后类型；重新扫描all也可，已完成且内容/模型相同的索引会跳过向量计算。

processed代表已回放记录数，包含非公开来源与内容未变的记录，不是新增文档数。高水位只在每类开始时获取，不是跨五类的统一数据库快照，也不会跨进程持久化。断电/输出丢失时可重跑；本测试不承诺供应商调用不重复或端到端exactly-once。失败回放的原UUID会保留一个pending、无活动租约的Inbox行，续跑使用新UUID；本次最终清理已删除这些隔离记录，生产保留期限仍需运维策略。

人工停用不会因回填自动恢复。物理删除源留下的孤立索引、字典稳定值变更前的旧SourceKey不在源表扫描清理范围，当前检索会排除它们；不宣称完成全库垃圾回收。实际语料质量、查询计划/容量、长文本分块、运行中并发业务写入和长期租约恢复仍需独立验证。

## 工程与证据

三仓新D盘副本各自冻结安装/check通过；Backend1462单测、20源码工具、177HTTP框架、build及编译OpenAPI，Web3045业务/20源码/20发布工具、双无缓存构建与standalone，App1217业务/20源码/10产物工具、Doctor20/20、三平台导出及封存迁移通过。原有6条后端lint警告保留。完整数据库859项、真实存储51项与Kafka/DeepSeek24项为此前独立证据，本轮未重跑。

首轮工作区类型检查仅发现子进程退出码联合类型未收窄，修复后冻结副本完整通过，失败记录保留。本轮没有产品接口/数据库/前端行为变更。原始结果见[三仓同版报告](../validation/rag-backfill-cli-20261104.json)。完整浏览器、Expo设备/SecureStore/签名包、容器、远程CI和生产环境验收仍待完成，整体目标未完成。
