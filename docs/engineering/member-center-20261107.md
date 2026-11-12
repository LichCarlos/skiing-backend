# 2026-11-07 个人笔记收藏与官网发布

北京时间 2026-11-07 13:04:47 API 与官网已上线，OpenAPI 1.54.0。用户在官网个人中心通过 Tiptap 创建社区 Dynamic 笔记；知识 Article 仍由管理员维护。提交待审，管理员沿用社区动态审核页面批准后公开。作者管理、公开后编辑重新待审及软删除继续使用既有本人权限和 expectedVersion，未另造一套审核领域。

会员收藏增加 `dynamic` 类型及 `GET /me/favorites/:targetType/:targetId` 私人状态接口。动态必须处于公开、已发布且未删除状态；重复收藏由唯一索引保证幂等。下架或重审后内容不再公开展示。为兼容当前移动端，`/me/favorites` 未显式给 targetType 时仍只返回原有 resort/article；官网笔记收藏显式请求 `targetType=dynamic`。私人收藏状态及自己的笔记响应使用 private,no-store。

第 27 个迁移 `20261107050000_dynamic_favorites` 增加 Favorite.DynamicId、Dynamic 外键、用户/动态唯一索引与反向查询索引，并使用 num_nonnulls 检查三个目标恰好一个非空。兼容已有两类收藏，无 seed 和旧内容迁移。

本轮通过 1525 项单元测试、159 文件，178 项框架 HTTP E2E、9 文件，克隆真实 PostgreSQL 收藏专项 7 项，API 类型检查、Linux 生产构建及数据库校验。lint 保留 6 条既有无关脚本警告。克隆真实 HTTP 与浏览器验证 pending/public 404、非作者读取/编辑拒绝、审核批准、收藏幂等/私密/类型兼容、版本冲突、发布编辑重审、下架及软删除；克隆上传图片通过实际扫描并完成清理。

正式域名健康、契约和游客私有接口拒绝通过；官网真实登录、写作页、收藏、刷新会话及退出通过。正式站未创建测试业务内容。发布前后文章 8、动态 20、资产 34、用户 18、雪场 5 保持；迁移 26→27。

发布目录 `/opt/linji/releases/20261107-member-center/backend`，PID 1488566。官网构建 ID `-pXIJMFe4DFcnjkm4KJep`，PID 1488567。管理端 PID 1464533 保持，Nginx 未改配置。API 源文 SHA256 `40b7c5866b4241ddf19fc305c162fd4513ced18cd699901be896f634f1d6b307`，契约 SHA256 `09f9a1724f89899c50761950d861c924fa251a82c577a8766e078e38e9a70c16`。

发布前数据库及 MinIO 完整备份在 `/opt/linji/private/backups/20261107-member-center`；克隆恢复、迁移和校验后独立验收，再上线迁移。验收完删除命名克隆库 `linji_member_rehearsal_20261107` 与候选环境文件。

回滚：`python3 /opt/linji/releases/20261107-member-center/rollback.py`，恢复旧 API/官网 unit，保留增量 schema。不得恢复旧备份覆盖用户上线后的新内容。本轮未执行回滚，源码未提交或推送。

[机器报告](../validation/member-center-20261107.json)。
