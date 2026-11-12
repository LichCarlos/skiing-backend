# 字典管理与层级 RAG 验收

2026-10-31 更新：字典六类写命令现已补齐事务内有效身份、入口与动作授权复核，拒绝不留下配置/审计/Outbox，见 [事务内配置授权](configuration-write-authorization.md)。下文 2026-10-29 的验收数字为历史记录。

2026-10-29，API-M09 既有契约的真实 HTTP/PostgreSQL 验收与缺陷修复。没有新增路由、外部字段、依赖或 migration；OpenAPI 保持 1.31.0。

## 修复后的行为

管理列表/详情/树查询、类型与项创建/编辑/软停用，使用真实认证、当前授权 Guard、DTO、Application 和 Prisma。普通用户及游客拒绝；具备管理入口和对应动作授权的自定义角色可管理字典，已提交撤权后旧 JWT 的下次请求拒绝。

非空可选属性允许省略，明确传 null 返回400。仅 parentId/color 接受 null，分别表示解除父级/清空颜色。过长请求 User-Agent 截取到审计列500字符，IP限制64字符，避免合法业务写入因附带请求信息超限而500。操作者与 traceId 来自服务端，客户端伪造的 body 审计字段拒绝，传入的 trace header 不作为可信日志身份。

类型分组与字典项父子树独立；字典项保持稳定排序。父级必须同类型且存在，禁止自身或祖先环。Serializable 事务防止两个并发父级变更共同形成环；冲突返回409，重新读取后重试。DELETE仅软停用，保留引用与可恢复记录。

重命名字典 value 时保护文章分类、雪场标签、四类业务实体的 JSON 动态字段和字段默认值；单选字符串/多选数组均检查。停用定义、软删业务记录仍检查，避免恢复后失效。JSON条件参数化，经字段定义限定实体/字段键，不扫描无关 JSON 内容。引用检查和字典更新同事务；其他模块的全部并发写入未在本轮穷尽验证，不宣称跨所有业务写入永久无竞争。

## 层级变化与 RAG

原实现仅为修改的字典项产生事件。父项标签、位置或状态变化后，后代的来源指纹变化，实时检索会隐藏旧向量，但缺少事件使后代不能自动重建。现由父项更新/软停用事务读取同类型树，以有 visited 集合的迭代遍历为当前项及所有后代追加 dictionary.changed.v1 Outbox。仅当前项携带 previousValue，供改名时停用旧 SourceKey；无关分支不追加。类型变更仍为该类型所有项追加事件。

配置、OperationLog与整棵受影响子树的Outbox事件同事务提交。失败全部回滚，Kafka投递后由既有Inbox幂等与当前来源检查处理。不会依赖Kafka提供端到端exactly-once。实时检索在消费者追上前继续拒绝旧层级指纹。父项停用后后代来源停用；重新激活后通过事件重建向量并恢复公开检索。

子树追加目前逐项写Outbox；大字典树的事务耗时与批量优化尚未做性能验收，不把小规模用例结果推广到任意深度/规模。

## 验收范围与复现

新增 test/managed-dictionaries.db-spec.ts：真实登录/JWT/Guard/Controller/Prisma、默认私有、树读写/排序/分页/筛选、空值规则、URL类型隔离、唯一约束、复合父外键、并发防环、文章/雪场及动态字段引用、软停用/恢复、审计/Outbox与失败回滚、后代事件和pgvector恢复。数据库套件禁止文件并行，使用专用空库，不向开发或生产库运行。

六类写操作的审计故障使用超长内部测试 TraceId 触发实际 PostgreSQL INSERT 错误，比较配置快照、版本、日志/事件数量。另使用只匹配唯一测试AggregateId的临时数据库触发器使Outbox INSERT报错，验证已经插入的审计和业务更新一并回滚，finally移除触发器/函数。未替换Prisma或放宽数据库约束。

RAG链路采用真实来源读取、Outbox记录、Inbox/租约、索引写入、pgvector检索，Embedding为固定1024维向量替身；直接调用既有事件Handler，未在本轮启动真实Kafka或调用模型服务。每条事件重复处理验证Inbox拒绝重复；验证父项改名后旧指纹立即隐藏、消费后显示新路径，停用/恢复后后代来源与检索相应变化。

## 测试发现的失败

首次25项：15通过、10失败。真实问题为null绕过IsOptional、过长User-Agent导致500；另雪场标签测试夹具错误使用任意字典类型，违反现有resort.fit_tag CHECK，已修正夹具，未放宽约束。原测试误以为PostgreSQL偏移必须为32位；实际大偏移可用，改为验证现有安全整数计算上限，没有收紧业务协议。

随后24/25通过，一项分页夹具并发创建遇到Serializable 409；普通夹具改为顺序创建，并发防环保留专用用例。子树事件测试实际复现只有父项事件，修复后连同真实pgvector恢复验证通过。再追加五类动态字段引用用例，全部复现200错误放行，修复后纳入最终全量复验。测试侧曾有不存在的inboxEvent命名/检索签名错误，类型检查失败后按实际ConsumedEvent与检索端口修正。

## 最终实际结果

三仓独立 pnpm install --frozen-lockfile 通过。Backend check 110文件/639项、HTTP 3文件/80项、build/OpenAPI通过；独立空库19迁移、两次seed、测试前后db:verify和再次deploy无pending通过。完整数据库14文件/139项，其中字典专项33项。Web check115项与官网/Admin production build、App check64项/Doctor20/20与iOS/Android/Web export均通过。两客户端本轮无业务改动。

OpenAPI仍为1.31.0，三仓SHA-256为c7587cc03993c0924b5883be6dcdbe8aca3c12121750fca4a6de96c5f3f9760d；Web/App快照与生成类型校验通过。没有新增依赖或migration；远程CI未执行，已有CI的test:db会自动包含新增套件。

临时容器linji-dictionary-validation-20261029，完整ID ce1f0a54a942f8997b934329726651f2b919f212baa352d66d73ac6b3f99fe6c，pgvector/pgvector:pg17，loopback随机端口58339。核对完整ID、名称、标签和AutoRemove后停止，已确认自动移除；其他项目4个容器和用户官网/Admin服务未改变。复验需创建新的专用库，不能复用历史端口。

浏览器点击、真实broker/provider、本轮真实ClamAV/对象存储、性能或生产部署均不在本轮证据内。完整权限目录数据库验收、配置/Outbox/AI管理和项目其他契约缺口继续保留，整体项目未完成。未提交或推送。
