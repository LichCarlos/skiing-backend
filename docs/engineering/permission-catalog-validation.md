# 权限目录与单节点详情验收

2026-10-31 更新：目录创建/编辑/软停用已在写事务内复核有效授权；API 注册表同步同时复核受保护管理员身份。见 [配置事务授权](configuration-write-authorization.md)。下文 2026-10-29 的验证数字为历史记录。

2026-10-29，API-M04 / D-43。新增已确认的 `GET /admin/permissions/:permissionId`，并补齐既有权限目录的真实 HTTP / PostgreSQL 验收。没有新增依赖、数据库列或 migration。

## 接口与授权

详情返回 `ApiResponse<PermissionCatalogVO>`，包括节点及按 sortOrder、permissionId 排序的子树，包含 disabled 节点；节点不存在返回404，非法 ID 返回400。沿用管理入口与 system:permission:list 权限。Application 复用仓储完整树，在有效树中迭代定位节点；无额外仓储端口或逐层数据库查询。此实现读取整棵目录，尚未验证大规模目录的性能。

静态 GET /admin/permissions/tree 继续提供有效授权树，要求管理入口、system:role:list 与 system:permission:assign。真实模块和 HTTP 测试验证其不被动态 ID 路由覆盖。游客401，普通账号403；授权自定义角色可读取目录并执行已获准的目录动作。已提交的动作/入口撤权后，旧 JWT 的下一次请求被拒绝。sync 额外限制为有效 system_admin。

自定义节点只允许 custom: 前缀与 directory/menu/button 类型。目录为根，menu 属于 active directory，button 属于 active menu；拒绝自身、后代、缺失和错误类型父级。创建、更新、停用、同步仍用 Serializable 事务，业务配置与 OperationLog 原子提交。P2002 唯一冲突、P2034 序列化冲突转换409，调用方重新读取后决定重试，不盲目重放旧值。

PATCH 仅处理值不为 undefined 的属性，修复 class-transformer 创建 DTO 后可选属性已存在、原 hasOwn 判断误将省略字段作为输入的问题。省略字段保留；parentId/route/icon 接受 null（父级仍需合法），其余非空可选属性明确传 null 返回400。空 PATCH 返回400。menu 的非空路由在创建和编辑时均要求以 / 开头。请求 User-Agent 最多记录500字符，IP最多64字符；操作者与 traceId 由服务端生成，body 伪造上下文拒绝。

DELETE 仅软停用无任何子节点、无任何 RolePermission 引用的 custom menu/button；停用子节点、停用角色的引用仍阻止父节点停用。代码节点与自定义目录受保护。已停用节点的重复 DELETE 幂等，不追加重复成功日志；PATCH status=active 可恢复。代码 UI 元数据可编辑，不能借目录编辑修改 API 能力或分配账号角色。

## API 注册表同步

同一事务预读全目录，检查结构、父子类型、父级状态，以及注册 API 的 key/type 冲突和声明父节点。任一非法树或冲突返回409，拒绝整次写入。预检后只 upsert 注册 API，保持可编辑 UI 元数据；已移除 API 标记 disabled，保留角色关联。缺失注册 API 可重建，重复执行保持同一组 API，返回 created/updated/disabled 计数并写一条审计。

source 继续由当前注册表 membership 推导；不引入历史来源持久化。已退休 API 即使不在当前注册表中，仍因 permissionType=api 禁止手工编辑/停用。授权分配和最后管理员保护沿用原实现，本轮没有重定义业务身份。

## 真实验收与失败记录

新增 test/permission-catalog.db-spec.ts 共29项：真实登录、BCrypt/JWT、当前授权 Guard、DTO、Application、Prisma；排序树/子树详情、静态 tree、404/非法ID、部分更新、空值、不可变属性、类型/父级、代码节点保护、角色引用、旧 JWT 撤权、重复并发创建、同步创建/重复/退休/冲突、审计与四类失败回滚。

四类审计故障通过超长内部 TraceId 触发真实 PostgreSQL OperationLog INSERT P2000，比较完整权限表快照与日志数量。同步故障特意准备待覆盖名称与待退休 API，验证已执行的元数据覆盖、停用及审计全部回滚。未替换 Prisma 或放宽约束。并发创建验证只有一条权限和一条成功审计，另一请求409；未穷尽所有目录写入/授权分配并发组合。

首轮26项7通过、19失败：缺失详情路由，省略属性导致 PATCH 422，重复创建500，创建时 null 被默认值吞掉，更新时 null 未在 DTO 层拒绝，超长 User-Agent 500，同步错误放行类型/父级冲突。修复后24/26通过；剩余两项是测试夹具问题（把创建时空 children 一并用于匹配完整子树、停用角色夹具漏填 DataScope），已修正。增加部分 PATCH 保留、缺失修改/删除与代码 API 禁改、授权角色编辑代码 UI 三项后29项通过；类型检查发现的夹具问题也已修复。

HTTP e2e 增加详情/404/非法ID/Guard/OpenAPI 检查；原 tree 路由测试保留。已有 CI 的 test:db 自动包含新文件。写事务沿用本次 Guard 的授权结果，未在事务内重新解析全部 RBAC，不宣称并发撤权会终止所有在途请求。浏览器交互、远程 CI、真实对象存储、模型 provider、性能和生产部署未在本轮验收。Kafka/ClamAV 历史结果不作为本轮重跑证据。

## 本轮执行结果

三仓独立冻结安装通过；Backend check 110文件/639项、HTTP 3文件/81项与 build/OpenAPI 通过。专用空库完成19迁移、两次seed、结构校验，完整数据库15文件/168项通过，加强同步审计回滚夹具后再次全量168项通过；测试前后结构校验和重复deploy无pending通过。Web check115项与官网/Admin production build、App check64项/Doctor20/20与iOS/Android/Web export均通过。Web首轮仅生成的契约锁文件格式失败，格式化后完整check/build通过。

OpenAPI 1.32.0，三仓 SHA-256 为 e39f4b23d288bbdcea1b567b7fa82bfe095d4fcaab8998959cc92f2e04b1f74f。Web/App 的快照、锁和本地生成类型已更新；两客户端未增加业务页面。

文档收尾检查62份Markdown、271条本地链接，零坏链；本阶段后端TS/文档及Web格式检查通过。后端版本文件另一次格式检查失败后已格式化并复验通过，未改变接口定义或哈希。

临时容器 linji-permission-validation-20261029，完整 ID f1444edabbe9a6af545d9961cf2afed77210ed3652471a19d2de86690d55a8fc，pgvector/pgvector:pg17，loopback 随机端口49309；仅使用专用 linji_validation 数据库，不写 .env。验收后已核对完整ID、名称、标签和AutoRemove=true，仅停止该容器并确认自动移除；其他项目4个容器及用户官网3010/Admin3001仍运行。复验应新建专用库，不能复用已移除容器的端口。整体项目仍未完成，未提交或推送。
