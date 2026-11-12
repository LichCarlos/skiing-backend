# 角色写入事务授权

日期：2026-10-31。负责人：Backend 身份与平台管理模块负责人。范围：既有 API-M03 的角色创建、修改、软停用和授权快照替换；沿用 OpenAPI 1.44.0，无新接口、字段、依赖或数据库迁移。

## 问题与实现

原入口 Guard/Controller 已检查有效身份、管理入口、动作 grant 与 `role` 数据范围；保存事务只检查 active 账号，配置默认范围/替换授权时另查 system_admin 成员关系。如果入口读取之后、写事务快照建立之前完成撤权、角色解绑或范围缩小，原实现仍可能继续写入。

`infrastructure/role-write-authorization.ts` 使用调用方的 Prisma TransactionClient，执行既有 Principal Reader/Resolve 用例及领域授权函数。四类写入在第一次目标读取/业务写入之前重新校验有效账号、角色、活动权限、管理入口及动作对应的 `role` 范围。新建只允许 all；修改/停用必须 all 或 selected 包含目标角色；self/merchant 拒绝，多角色冲突继续 fail-closed。

授权快照替换独立检查 `system:role:update` 和 `system:permission:assign` 两个动作及各自目标范围，两者都满足才可替换。替换快照、非 self 默认范围创建以及显式 PATCH dataScope（包括原值）另查活动角色同时具有 `RoleKey=system_admin` 和受保护的 `SystemRoleCode=system_admin`。商家和自定义角色继续按 grants 工作，不使用商家角色键判断能力。

拒绝抛出领域授权错误，由 Application 转为 403；不执行配置修改、授权集合删除或成功审计。角色元数据、三个授权集合与 OperationLog 保持原 Serializable 事务。系统角色保护、注册基础角色保护、未知资源键兼容规则、引用校验和 P2034→409 沿用原实现。Controller 的前置检查仍保留。

授权依据是当前写事务的数据库快照。能拒绝快照建立前已提交的撤权，不保证取消快照建立后的所有并发撤权；本轮未增加授权行悲观锁、自动写入重试或跨请求幂等键。也不能据此宣布其他资源全部完成事务授权或浏览器验收。

## 验证证据

`test/role-write-authorization.db-spec.ts` 新增 41 项真实 PostgreSQL 用例，调用生产 Application/Repository，不 Mock Prisma。验证委派三类元数据写入成功与审计、入口授权读取后动作/入口撤权、账号停用、角色停用/解绑、多角色范围冲突、selected 目标限制及创建拒绝、self/merchant 拒绝、默认范围管理员专属、授权快照管理员降权/解绑/停用/混合身份拒绝及实际审计 INSERT 失败回滚。

每个拒绝/回滚用例比较本套件角色、权限关联、资源范围、字段策略及完整审计快照。夹具只直接创建本套件拥有的合法数据；已有 HTTP 生命周期套件继续覆盖真实 Guard/Controller/DTO。新测试先读取入口授权、在独立提交中改变授权，再调用实际应用写用例，证明事务内复核；没有模拟 HTTP Guard 在途暂停，也没有把它写成快照建立后即时撤权保证。测试不改动 seed 管理员、系统角色和全局权限记录。

新套件与原 `role-authorization.db-spec.ts` 合计 2 文件/62 项通过。更新仓储单测的完整 Principal 夹具与受保护身份查询断言，新增两项 Application 403 映射测试；相关 4 文件/25 项通过。Backend 完整 lint/typecheck、118 文件/855 单测通过。

三仓分别冻结安装通过。完整真实数据库、HTTP、三端检查/构建/导出最终结果见下文；日志使用 `role-auth-*.log`，App 产物为 `dist-role-auth-validation/`；保持日志、验证库与原开发进程。

首轮完整数据库为 29 文件/639 项，其中 636 通过、旧 `managed-role-scope.db-spec.ts` 三项失败。旧断言依赖原仓储错误类型，且元数据允许夹具没有任何角色/grant。现在该夹具显式拥有管理入口、create/update 与 role all 的委派角色；切换管理员前清除委派身份，避免与既有 system_admin 不混用规则冲突。拒绝断言使用新领域授权错误，生产授权未放宽。首轮失败日志 `role-auth-db-full.log` 保留；专项与完整复验另存日志。

夹具首次复验又发现新增委派角色键拼接完整 UUID 后为 52 字符，超过数据库 varchar(50)，导致旧套件 beforeAll 失败、三项跳过；另外两套件 62 项通过。已将该夹具 UUID 后缀缩短为 16 字符，未改数据库长度约束，失败日志 `role-auth-db-recheck.log` 保留。

修正后新事务授权、原 HTTP/PG 授权与旧默认范围三组专项共 3 文件/65 项全部通过（`role-auth-db-target-final.log`）。Backend 完整 lint/typecheck/118 文件 855 单测再次通过（`role-auth-check-final.log`）；真实 HTTP 3 文件/88 项、build 与 OpenAPI 导出通过，导出哈希保持不变。Web 完整 check 488 项及官网/Admin 构建，App check 183 项、Doctor 20/20 与三平台导出通过。

## 最终完整结果

最终真实数据库全量 29 文件/639 项全部通过，耗时 328.47 秒（`role-auth-db-full-final.log`）。测试前后 db:verify 通过，仍为 20 个迁移。初轮失败与专项复验日志均保留，未通过修改生产约束或事务超时规避问题。

三仓 OpenAPI 1.44.0 SHA-256 均为 `98baf03cc01588729adc9581fce4980a7eca8855b91e03fc37a9aa8a51d99cc2`。没有新增协议、依赖或迁移，Web/App 业务代码不变。结束后数据库仅原管理员，动态/评论/操作日志为 0，本套件角色与委派角色无残留；原 `project_doc.changed.v1` / AggregateId 32 待处理 Outbox 保留。原官网/Admin 开发进程、验证容器、日志和 App 导出产物保留。

修改过的后端 TS 与 Web 文档格式检查通过；114 份 Markdown 的 614 个本地链接有效。三仓 README 正文中的当前契约版本/哈希与快照一致；中央契约中的旧资源目录待确认描述已改为现有 D-23 行为。未提交、推送或部署；浏览器/设备/真实供应商、全局工作台、RAG 运维、AI 会话审计及全项目交付验收仍未完成。
