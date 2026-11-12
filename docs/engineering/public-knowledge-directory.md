# 公开知识目录查询验收

日期：2026-10-31。对应 API-K01、D-28/D-36，继续使用 OpenAPI 1.41.0；不新增接口、数据库迁移或依赖。

## 规则与修复

公开列表保持 page/pageSize/total/hasNext，按 PublishTime DESC、ArticleId DESC 稳定排序。标题或摘要按关键词不区分大小写包含匹配，分类按 categoryValue 精确匹配；列表/count 共用公开条件，并在 RepeatableRead 快照内读取。游客收藏状态恒为 false，登录用户的身份只从服务端认证上下文获取。

真实 HTTP/PostgreSQL 测试发现 Prisma contains 会把 `%`、`_` 和反斜杠解释为 PostgreSQL LIKE 模式。现由 Infrastructure 在传给 Prisma 前转义这些字符，保留用户输入的字面包含含义；参数仍通过 Prisma 绑定，不拼接 SQL。Application、Domain 及 HTTP DTO 继续沿用现有职责，没有把数据库转义规则放入前端或领域模型。

草稿、撤回、软删除、缺少发布时间或分类不可公开的文章仍不对外提供；收藏关系不扩大可见性。分类接口只投影 value/label。公开 VO 不包含正文以外的管理元数据、来源 URL 或内部权限信息；列表不带正文。

## 可重跑的证据

`test/article-favorite-state.db-spec.ts` 从 16 项扩至 31 项，使用真实 Nest HTTP、DTO、认证 Guard 和 PostgreSQL。新增 15 项覆盖字面特殊字符、标题/摘要大小写、关键词 trim、分类组合、同一发布时间的 ID 次序、分页 total/hasNext、后续空页、缺少发布时间、分类停用和非法参数 400。原有收藏隔离、Cookie/CSRF、撤销会话和 ID 边界继续运行。

测试先证明特殊字符三个失败，再修正仓储并复验通过；测试记录保留在本地忽略日志中。新增夹具修改由 finally 恢复，套件只删除自己创建的记录，不删除原有 Outbox 事件。外部对象存储为替身，不能据此声称已完成真实图片下载验证。

## 尚未证明

当前证据不覆盖真实存储、浏览器成功数据工作流、原生设备、检索性能压测、生产数据或完整项目交付。AI 运维/会话审计与待定版接口仍单独追踪，不因公开目录验收被标记完成。
