# 本人动态查询（D-03）

2026-10-29 用户确认列表与本人详情契约；OpenAPI 1.28.0。

| 接口                          | 参数与响应                                                                                   | 授权                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------- |
| `GET /api/v1/me/dynamics`     | `page=1`、`pageSize=20`（1–100）、可选 `status=pending/published/hidden`；`OwnDynamicPageVO` | 登录且有 `community:dynamic:read-own` |
| `GET /api/v1/me/dynamics/:id` | `OwnDynamicDetailVO`，完整正文、可读取图片、状态和更新时间                                   | 同上，必须本人                        |

列表按 `CreateTime DESC, DynamicId DESC` 排序。列表和计数使用同一 RepeatableRead 事务快照；响应是偏移分页 `{items,page,pageSize,total,hasNext}`。卡片字段与公开动态卡片一致，但状态包含三种审核状态。列表不返回完整正文；详情不内嵌评论，也不暴露审核人员、原因或存储 key。

Controller 从认证上下文取 userId，不接收 owner/authorId。Application 通过 `OwnDynamicsReader` 端口查询，Prisma adapter 在列表、计数、详情的数据库条件中加入 `AuthorId=userId`、`DeletedAt=null`。非本人、已删除、不存在的详情统一 404。只有当前账号拥有且 ready 的图片获得 900 秒签名地址；公开 `/dynamics` 和详情仍只返回 published 数据。

新增权限已注册并进入新建注册用户角色的初始模板。既有角色的 seed 不覆盖人工授权：升级时由 system_admin 同步权限目录，并在角色授权页面显式给需要访问此功能的角色授予 `community:dynamic:read-own`，保留既有 grants/dataScopes/fieldPolicies 完整快照。不要用业务身份名推断该权限。

写入继续使用原 `PATCH/DELETE /dynamics/:id` 与 `community:dynamic:update-own`；已发布正文编辑进入 pending，DELETE 软删除。没有新增绕过审核的写路由。本阶段不改数据库结构。

验证：adapter/application 单测覆盖本人条件、分页、状态、ready Asset 和 404；HTTP 测试覆盖 401/403、DTO 校验、认证主体传递与 OpenAPI 路由。测试使用数据库替身，不替代真实 PostgreSQL 事务和所有权集成验证。

## D-37 图片与雪场编辑

本人详情新增必填 `images: [{assetId,url}]`，Asset ID 为十进制字符串；仅返回当前账号拥有且 ready 的图片，按相册顺序排列，`imageUrls` 从同一数组派生。公开详情不新增图片 ID。

PATCH 的 `resortId` 省略保留、null 解绑、正整数改绑到已发布且未删除雪场；字符串、布尔、零、负数及小数拒绝。`imageAssetIds` 省略保留、数组全量替换并按顺序保存、空数组移除全部关联；旧图和新图都在事务内校验本人及 ready。移除关联不删除 Asset。已发布动态编辑转 pending，图片/雪场/正文和 Outbox 同事务提交。

应用、reader 和 HTTP 测试已覆盖 D-37；真实数据库测试新增保留/解绑/改绑、图片顺序及 owner 详情回传/原 Asset 保留用例，尚未执行。
