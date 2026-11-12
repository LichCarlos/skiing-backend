# D-30 本人资料与头像资产

2026-10-30，OpenAPI 1.36.0。规则已由用户确认；本功能属于 IdentityAccess，存储与签名由 Assets 的端口提供。

## 接口与数据

`PATCH /api/v1/account/profile` 要求有效登录和活动 `account:profile:update` 权限，不要求管理端入口或商家身份。用户 ID 只取认证上下文；事务内再次校验账号、角色和权限状态。

请求 `UpdateProfileDto` 仅允许：

| 字段             | 规则                                                                              |
| ---------------- | --------------------------------------------------------------------------------- |
| `nickname?`      | 字符串，trim 后 1–50 个 Unicode 码点；不允许 null                                 |
| `avatarAssetId?` | 正十进制 int8 ID 字符串；本人拥有、ready、JPEG/PNG/WebP 图片。省略保留，null 清除 |

至少提交一项。账号、角色、商家、状态、原始 URL 等额外字段均拒绝。成功返回 `UserProfileVO={userId,account,nickname,avatarAssetId,avatarUrl}`，两个头像字段可空；沿用统一响应外壳。非法输入/资产为 400，无登录 401，无权限 403，并发冲突 409。

## 迁移与兼容

先执行 `pnpm db:deploy`，再部署使用新 Prisma Client 的代码。迁移 `20261030000100_user_avatar_asset` 只新增可空 `User.AvatarAssetId BIGINT`、索引及指向 Asset 的 RESTRICT 外键，不根据历史 URL 猜测 Asset ID，不改写存量 `Avatar`。

仅改昵称保留历史 `Avatar`。显式替换或清除头像时，在同一事务设置 AvatarAssetId 并清空旧 Avatar。读取优先使用关联 Asset，仅本人 ready 图片生成 900 秒签名 URL；已关联但不可读的资产返回 null，不回退旧 URL。没有关联时兼容读取旧 Avatar。签名 URL 不持久化到数据库。

登录、`/auth/me`、refresh、公开动态列表/详情、评论及本人动态列表/详情均使用此规则。当前用户 VO 仍保持原有身份/权限结构，不额外扩充资料字段。

## 一致性与删除保护

资料写入采用 Serializable 事务；绑定新头像先 `SELECT Asset ... FOR UPDATE` 后复核归属、状态与 MIME。用户修改与 `account:profile:update` OperationLog 同事务，Metadata 只记录字段名，不存昵称和签名 URL。Prisma P2034/P2003 及原始行锁 SQLSTATE 40001/40P01 映射 409，不自动重试。

本人删除和管理端删除均先在事务内锁同一资产行，再以新的语句检查全部引用并软删除；`AvatarUsers` 包含在引用条件中。分成两个语句能让 ReadCommitted 在等锁后读取已提交的头像引用。外键阻止物理删除，管理端 `AdminAssetVO.references.userAvatars` 显示头像引用数。解除或替换头像后，旧资产可按普通未引用资产规则删除。

## 验收与边界

`test/user-profile.db-spec.ts` 使用真实认证、权限、HTTP、Prisma 和 PostgreSQL，替换外部对象存储签名/删除。覆盖非法输入、跨账号、撤权/停用、三种图片、旧 URL 兼容、全部头像读取入口、引用计数/删除/外键、审计失败回滚和真实行锁竞争。并发场景通过 `pg_stat_activity` 确认请求确实等锁；另覆盖头像先提交、删除已等锁后的引用复核。

这不等同于真实 S3/MinIO、浏览器、手机相册或设备联调验收；还需配置真实私有存储和扫描服务，验证上传、签名 URL 到期及设备显示。迁移属于增量升级，本阶段不对生产库执行命令。最新完整检查数字见三仓 README 和项目测试记录。

## 2026-10-30 执行结果

本阶段最终验证：三仓独立 frozen install 通过；Backend lint/typecheck、114 文件/680 单测、3 文件/84 HTTP 测试、19 文件/265 真实数据库测试（D-30 为 29 项）、build/OpenAPI 通过；Web 完整 check 164 项及官网/Admin production build 通过；App 完整 check 87 项、Doctor 20/20 及 iOS/Android/Web export 通过。专用验证库增量升级至 20 迁移、两次 seed、测试前后 db:verify、重复 deploy 无 pending；头像 bigint 可空、索引及 RESTRICT 外键已核验。

OpenAPI 1.36.0，三仓 SHA-256：`b4c2635a9e2d16e8e6cc90e30448eb5620918530ef8eb60730d0fb54b2521062`。存储使用替身的验收不代表真实 S3/MinIO。

验证结束后仍保留既有 `linji-events-validation-20261030` 容器（本机回环 53240 端口）与历史 App `dist-events-validation/`。此前自动审批以 `blocked by policy` 拒绝其组合清理，未重新尝试；本阶段使用 App 已忽略的 `dist/` 导出。未启停用户开发服务或其他项目容器，未提交/推送。
