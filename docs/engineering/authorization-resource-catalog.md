# 授权资源目录与角色快照验收

2026-10-29，D-23 / API-M03。用户已确认资源目录、管理端新增范围及历史未知键兼容规则。本轮没有新增依赖、数据库列或 migration。

## 目录协议与职责

`GET /api/v1/admin/authorization/resources` 返回统一响应包装内的 `AuthorizationResourceVO[]`；每项仅有 `resourceKey`、`label`。要求有效登录、管理入口 `management:portal:enter` 与 `system:role:list`。游客401，无入口或列表权限403。目录是代码注册表，不开放创建、编辑或删除接口。

| resourceKey | label    |
| ----------- | -------- |
| article     | 知识文章 |
| asset       | 资产     |
| resort      | 滑雪场   |
| role        | 角色     |
| user        | 用户账号 |

Domain 的 `AUTHORIZATION_RESOURCES` 是唯一目录；Application 用例返回元数据副本，Controller 提供 Swagger VO。资源范围装饰器参数约束为注册表导出的联合类型，HTTP 测试扫描真实模块 Controller 元数据，要求已消费的资源集合与目录一致。新增资源必须先接入对应查询/写入的范围控制，再更新目录及测试。

目录不授予任何权限，也不承诺每个资源支持全部 scopeType。各资源、入口和操作继续执行既有规则：例如文章和资产不支持 merchant；角色管理采用 all/selected；商家雪场还须与本人有效商家归属取交集。多角色范围冲突仍拒绝访问。未接入的社区等资源不加入目录。

## 快照替换与旧数据

既有 `PUT /admin/roles/:id/permissions` 全量替换 permissionIds、dataScopes、fieldPolicies，仅 system_admin 可以配置授权，目标 system_admin 仍受保护。Guard 的入口、动作、role 范围检查与事务内操作者 active/管理员关联复核均保留。

仓储在 Serializable 事务中读取原快照，删除任何授权集合前校验资源键：注册资源允许新增/修改；未知资源只能在该角色原快照中已存在、scopeType 不变且 selectedIds 集合相同的情况下保留。ID 重排不算变更；新增、改名、改类型、增删 ID 均400。移除旧未知资源后，不允许重新添加。原有格式、scopeType、重复资源、selected IDs 及权限/字段引用校验继续执行。

三组授权、before/after OperationLog 同事务提交；拒绝或实际审计 INSERT 失败均不留下部分配置。P2034 沿用409重读重试。兼容校验基于事务内原快照，不信任客户端上传的 previous。旧未知键不会因此获得新业务处理能力。

本轮还修复既有角色 PATCH：roleKey/roleName/dataScope/status 显式 null 在 DTO 层400；description 仍允许 null 清空，省略字段保留。DTO 所有属性均为 undefined 的空 PATCH 返回400，不写成功审计。

## 测试与边界

`test/role-authorization.db-spec.ts` 共21项，使用真实登录、BCrypt/JWT、Guard、DTO、Application、Prisma 和 PostgreSQL。覆盖目录/入口及动作撤权后旧 JWT、三组快照替换与清空、未知键兼容/删除后重建拒绝、system_admin 独占及目标保护、selected 角色列表/count/详情/编辑/快照、缺失引用与非法输入无副作用、角色部分更新/状态/默认范围，以及授权和三类角色写入的真实审计失败回滚。

审计故障由内部超长 TraceId 触发 PostgreSQL OperationLog INSERT P2000；不替换 Prisma，比较三组授权/角色与日志状态。单测补充资源变更规则和 undefined 空 PATCH；HTTP e2e 验证目录权限、Swagger 及资源注册表与真实路由一致。

首轮数据库21项18通过：必填 PATCH 字段传 null 导致500，空 PATCH 错误200。修复后21项通过。两次类型检查还发现测试夹具的 it.each 参数与 Supertest unknown 请求体类型问题，均已修正。Web 首轮 SSR 测试因 HTML readOnly 属性大小写误判19/20，通过限定目标输入和忽略属性大小写后20/20；未放宽业务授权。

全库校验命令首次遗漏 INITIAL_ADMIN_ACCOUNT，verify 明确失败后补齐并重跑。所有测试仅使用专用库，不修改 .env。复验需新建空库，设置 DATABASE_URL、INITIAL_ADMIN_ACCOUNT 和 INITIAL_ADMIN_PASSWORD，先 db:deploy、两次 db:seed、db:verify，再 test:db、db:verify、db:deploy。不得对开发或生产业务库运行这些验收套件。

浏览器点击/API联调、完整授权并发组合、全域数据范围、真实存储/provider、远程CI、性能与生产部署仍未验。历史 Kafka/ClamAV 验收不作为本轮重跑证据。客户端仅锁定同一 OpenAPI 快照并在本仓生成类型，没有跨仓源码依赖。

## 执行结果

Backend 冻结安装、check（110文件/646项）、HTTP（3文件/83项）与 build/OpenAPI 已通过。三仓当前 OpenAPI 为1.33.0，SHA-256 为 `818f760493a4a4354fb7dbbb943a34bf2b499c156aaa2fec8bd13d3cd783b25b`。完整数据库16文件/189项通过，测试前后db:verify及重复db:deploy无pending通过。Web冻结安装、check132项与官网/Admin production build通过；App冻结安装、check64项/Doctor20/20与iOS/Android/Web export通过。后端首次格式检查误列不存在的src/openapi.ts导致命令失败，其余命中文件通过；改为实际版本文件shared/http/openapi-document.ts后复验。

专用容器 linji-role-validation-20261029，完整ID `33aab610639f748bf3212183aba20199e4979ebd70affc06286a362f939fab22`，label linji.validation=role-authorization，AutoRemove=true，pgvector/pgvector:pg17，loopback随机端口49595。已完成19迁移、两次seed与结构校验。收尾再次核对完整ID、名称、标签和AutoRemove后仅停止该容器，并确认自动移除；本轮role-validation-first.log已精确删除。其他项目4个容器及用户官网3010/Admin3001进程保持运行。未提交、推送或发布。

收尾检查64份Markdown、283条本地链接，零坏链；本阶段变更的后端TS、版本文件和文档格式检查通过。Web/App生成类型verify与三仓最终导出哈希一致。
