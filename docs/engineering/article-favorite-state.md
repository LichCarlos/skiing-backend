# D-36 公开文章收藏状态

2026-10-30，用户已确认。OpenAPI 1.37.0；不新增数据库表、迁移或依赖，复用 Favorite 的 `(UserId, ArticleId)` 唯一关系与索引。

## 读取协议

`GET /articles` 的每个 `PublicArticleSummaryVO` 和 `GET /articles/:id` 的 `PublicArticleDetailVO` 均包含必填 `favoriteByMe: boolean`。游客恒为 false；有效会话且账号 active 时按本人文章收藏关系计算。身份只来自 AccessTokenGuard，拒绝列表中额外的 userId 参数。无效、过期或已撤销会话按既有公开路由规则退为游客，不影响公开阅读。

公开过滤保持 published、未软删除、有 PublishTime；分类必须为 knowledge.article_category，字典项与类型 active，类型公开。收藏不能放宽公开性，也不会改变筛选、排序、分页或 total。ID 必须为数据库正 int4，非法 ID 在查询数据库前返回 400。

Application 的 PublicArticleReader 接收可选 userId，返回业务记录和布尔投影，不依赖 HTTP 或 Prisma。Infrastructure 使用当页 Article 的过滤 Favorites 关系加载本人状态；列表/count 继续在 RepeatableRead 事务。仅对外投影布尔值，不返回收藏 ID、其他用户或关联内部记录。

列表和详情响应均设置 `Cache-Control: private, no-store`。官网 SSR 读取公开内容；浏览器再按 Cookie 会话加载当页个人状态。调用方不可把 `credentials: include` 当成 Server Component 自动转发浏览器 Cookie 的机制。

## 写入与失败处理

写协议保持 `PUT /me/favorites {targetType: article, targetId}` 与 `DELETE /me/favorites/article/:id`，成功为 204。仍由后端验证 member:favorite:toggle、本人关系和添加目标的公开性；客户端不得新造收藏字段更新路由。

官网/App 在每次个人读取前使用 /auth/me 确认账号，沿用 transport 的短期 access 续期；提交时再次确认账号，成功或结果不明时重新读取状态。读回失败显示未知状态并禁止盲目翻转，不把网络错误解释为未收藏。客户端同步锁防重复提交，切换账号/页面取消旧请求并丢弃迟到结果。

## 验证

`pnpm check`、`pnpm test:e2e`、`pnpm test:db`、`pnpm openapi:generate`。数据库验收文件 `test/article-favorite-state.db-spec.ts` 使用真实 Nest 认证/Guard/HTTP、Prisma 和专用 PostgreSQL，存储适配器为替身。

专项覆盖游客/本人/他人、同数字 ID 的雪场与文章、不重复 PUT/DELETE、分页和内部字段隔离、失效会话/停用账号、撤回/软删除/分类停用、身份参数伪造、非法 int4 ID、Cookie 与 CSRF。Cookie 测试显式传递服务端签发的 Cookie；不代表已通过浏览器 Secure Cookie/CORS、真实设备或真实存储验收。完整阶段统计见仓库 README。
