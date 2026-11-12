# 收益 HTTP、CSV 与审计一致性验收

2026-11-01 收益恢复协议已实施，OpenAPI1.48.0含管理员读取/单条幂等/本人结果核对及CSV 202持久任务/本人进度查询。CSV任务使用migration 22、Outbox/Inbox、租约恢复、逐行事务和7/30天保留。Backend lint/typecheck/build、125文件/977单测、3文件/97 HTTP e2e、31文件/778真实PostgreSQL测试通过；db:verify前后均确认22个migration。数据库测试后保留原管理员和1条pending Outbox，未留收益/导入/幂等请求/操作日志夹具。真实broker故障演练、浏览器及生产容量/告警仍待验。见[收益恢复](revenue-recovery.md)。下方较早数据库案例属于历史证据。

## 2026-10-30 事务内授权与雪场引用锁

沿用 D-19/D-20/D-38 已确认的路由、DTO/VO 与授权规则。收益写入的每个 Serializable 事务现在通过事务客户端重新读取账号、有效角色、动作授权与管理入口，并复用 `resolveDataScope` 的多角色冲突拒绝规则。未增加 `RoleKey=merchant` 判断、内置管理员专属限制或新的收益资源范围；`revenue:system:upsert` 仍只能由 system_admin 配置。有效授权主体可经应用服务写入；缺失、无效或已经撤权的 actor 在业务写入前返回 403。

CSV 继续采用每行独立事务；前一行提交后若撤权，后续行重新校验并作为脱敏失败行返回，保留已成功行。服务端不把此前 Guard 的授权快照作为全批次写入凭证。

写事务在读取/写入收益前对未软删的 `SkiResort` 领取 `FOR SHARE` 锁，直至收益和审计一起提交，以协调雪场软删除/更新；对方先提交且当前 Serializable 快照过期时，PostgreSQL raw 40001/40P01 与 Prisma P2034 均映射为 409。客户端重读后决定是否重试，不自动重放旧金额。已软删或不存在的雪场仍为 422。

真实回归先运行再修复：新增 8 项测试全部失败，6 种 Guard 后撤权仍返回 200，直接应用写入缺失 actor 泄漏为外键错误，CSV 撤权后仍写入剩余行。修复后收益专项共 32 项通过，包含新增的 9 项真实数据库测试；3 项新增单测覆盖写入前拒绝与 raw SQL 冲突映射。

新增数据库案例涵盖账号停用、角色停用、角色解绑、入口撤权、动作撤权、多角色范围冲突；使用独立 fixture 角色，不修改共享内置管理员授权。通过仓储调用前的调度钩子，在真实 HTTP Guard 成功后提交撤权，随后执行原始真实仓储与事务，不替换权限解析、数据库或写入。另以真实删除事务持锁并从 `pg_stat_activity` 确认收益 `FOR SHARE` 正在等待，释放删除事务后验证收益 409、无新金额或审计。原有并发金额/审计、CSV 和商家隔离回归继续通过。

授权仍以事务内读取时的数据库快照为准，不保证该读取后发生的撤权能立即取消所有在途事务；未建立跨全系统的授权租约。收益查询仍遵循既有 Guard 与归属交集，不能把本轮收益写入修复宣称为所有查询及业务模块均已完成事务内授权。

本轮复用经身份核验的专用容器 `linji-events-validation-20261030`（loopback 53240，20 个迁移），未写 `.env`、修改开发数据库、增加依赖/migration 或变更 HTTP schema。未停止验证容器及用户开发服务。OpenAPI 仍为 1.39.0。完整三仓验收结果见本仓 README 的最新阶段记录，下方为历史证据。

2026-10-29，API-R03/R04，沿用用户已确认的 D-19、D-20 与 D-38。未增加收益管理路由、业务字段、依赖或 migration。OpenAPI 升至1.34.0，补充数据库整数边界和修正 note 的 Swagger 字符串类型。

## 协议与授权

商家仅有 GET /merchant/revenue 与 /summary，要求当前认证主体、管理入口、revenue:merchant:list 和有效 resort 数据范围；没有商家收益写接口。商家身份由 MerchantProfile 表达，不检查 RoleKey=merchant。查询、count、汇总、按日分组和名称沿用本人有效商家归属与 scope 交集；指定雪场汇总不可见404，列表无可见记录返回空页。多角色范围冲突拒绝。

管理员 PUT /admin/revenue 与 POST /admin/revenue/import 要求管理入口及 revenue:system:upsert；该 grant 仍只由 system_admin 配置。账号可具备多个可配置权限，本轮没有新增按业务身份硬编码的授权分支。actor/createdBy 取服务端主体，不接受请求伪造。

CSV 延续 UTF-8、可带BOM、固定四列 resortId,reportDate,revenueAmount,note、10 MiB/5000数据行上限。文件整体编码、语法、表头或行数非法时整批400，不执行写入；multipart超限413。合法文件逐行校验，每行独立事务，后续重复雪场/日期行失败，前一成功行保留。结果不回显原行或内部数据库错误。上传文件扩展名与 MIME 白名单仍由既有 FileInterceptor 检查。

## 修复与事务

resortId 和 page 补充 PostgreSQL int4 上限2147483647，防止有效JavaScript整数超出数据库参数范围后返回500；CSV和应用写入也复核雪场ID。金额继续十位整数、最多两位小数的非负十进制字符串，数据库 Decimal(12,2)，不经浮点运算。无效日期在格式化ISO前检查有限时间值，2026-99-99等返回422，避免 RangeError。

收益 upsert 从默认 ReadCommitted 改为 Serializable：读取原金额、唯一键写入、结果投影和 OperationLog 共用事务。Prisma P2034 在基础设施转换为业务错误，再由应用映射409；不自动重放旧请求。CSV 单行遇到冲突作为失败行返回，其他行继续。客户端应重读再决定重试。

同一雪场/日期再次录入更新金额、来源、备注，保留原始 CreatedBy；OperationLog.ActorUserId 记录当次修改人。成功审计包含真实 before/after，不将客户端金额当作旧值。实际审计 INSERT 失败时，新增和更新均回滚。收益不会为通用AI生成RAG索引。

UpsertRevenueDto.note 原来只标 nullable，反射成 object，导致客户端生成错误类型；现显式标 type:String，仍是可省略/可空字符串，不改变业务协议。

## 真实测试与失败记录

新增 test/revenue.db-spec.ts，装配真实认证模块、收益Controller/DTO/应用服务/Prisma仓储、BCrypt、JWT、Guard及PostgreSQL。测试不替换收益服务、Prisma、CSV解析或审计写入；未启动对象存储、Kafka或模型。

首轮22项19通过：超范围雪场ID与分页查询返回500；同一条收益并发更新得到两个200，审计before可能取到相同过期金额。修复后增加无效日期回归，23项通过。并发测试先用实际 SELECT FOR UPDATE 持锁，通过 pg_stat_activity 确认两请求阻塞，再释放；最终一个200、一个409，只有一条新增成功审计，最终金额与胜出请求一致。不是依赖任意sleep假设已并发。

其他覆盖：游客/普通账号/商家越权、旧JWT撤入口/动作、selected与归属交集、范围冲突、软删除/失效资料、分页/日期闭区间、Decimal精度和汇总、原创建人保留、超长User-Agent截断、非法输入无副作用、BOM/中文/逗号/引号内换行、重复日期、5000/5001行、文件/MIME/字节上限，以及真实OperationLog INSERT P2000后的新增/更新/CSV回滚。错误响应不包含数据库内部信息。

首轮前端类型检查暴露note反射问题，修正后重新导出三仓契约；后端lint曾提示测试数字sort未提供compare，已补数字比较器并复查。测试夹具早期查找了不存在的identity-session文件，随后通过rg定位identity-sessions；未将这些工具/夹具问题归于业务实现。

## 本地复验与边界

只对专用空库设置 DATABASE_URL、INITIAL_ADMIN_ACCOUNT/INITIAL_ADMIN_PASSWORD，依次执行 db:deploy、两次db:seed、db:verify、test:db、db:verify、db:deploy。CI既有test:db命令自动发现新文件。远程CI尚未运行。

本轮专用容器 linji-revenue-validation-20261029，完整ID a4ca3a38638739e824cd4154d7514efe29f39b99aa4d05237a8abca4c18bf26c，label linji.validation=revenue，AutoRemove=true，loopback随机端口56654，pgvector/pgvector:pg17。19迁移与两次seed、初始结构校验已通过，不写.env。Backend冻结安装、check110文件/647项、HTTP3文件/83项与build/OpenAPI通过；完整数据库17文件/212项、前后结构校验及重复deploy无pending通过。Web冻结安装、完整check149项（收益17项）与官网/Admin production build通过；App冻结安装、check64项/Doctor20/20与iOS/Android/Web export通过。已核对完整ID、名称、标签和AutoRemove，仅停止本轮专用容器，确认自动移除；其他项目4个容器及用户官网3010/Admin3001进程继续运行，未提交/推送/发布。

本轮不证明浏览器操作、所有授权撤销竞态、并发创建组合、CSV大批写入吞吐、集群数据库故障或生产部署。历史Kafka/ClamAV结果没有重跑，真实对象存储/provider与存量RAG回填仍待验。全项目保持未完成。

OpenAPI1.34.0，三仓SHA-256为 `858210915e4ee4643f7220737340148d3361be79c6b3b42ed91893b91ff24a5a`。快照、锁和本仓生成类型同步，保持三仓独立工程。

收尾检查66份Markdown、296条本地链接，无坏链；变更文件格式检查通过。三仓最终OpenAPI哈希和客户端生成类型verify一致。本轮没有创建父目录安装/启动脚本，也未尝试绕过先前被拒绝的父目录清理或生产启动。
