# Markdown 内容服务端实现

2026-11-06，本地代码完成，生产未部署。OpenAPI 1.53.0 / 151操作。

- Body/Content继续存源文；ContentFormat默认plain_text，新格式markdown_v1。
- shared/content/markdown.ts使用unified+remark-parse+remark-gfm，应用通过parser port注入，不污染Domain。禁止HTML/MDX、危险URI、远程/本地图片引用。
- 图片使用asset:ID；文章ArticleBodyAsset与正文、版本、审计、Outbox同事务，资产删除和孤立清理纳入该关系。社区复用DynamicImage，最多9张，正文图片必须是相册ID子集。
- article:ID/resort:ID仅校验公开目标，未实现持久化mention关系；主要ResortId保持独立。
- Markdown更新必须contentFormat+expectedVersion；文章原发布流、动态pending/hidden审核流不变。
- RAG对新格式从AST抽正文，旧纯文本不变。继续原Outbox/Inbox；本期未新增引用卡片依赖更新。

## 数据库和验证

新增迁移prisma/migrations/20261106000100_article_markdown_assets/migration.sql。只在新的回环隔离PostgreSQL17/pgvector集群执行过，26迁移/双seed/37文件868数据库用例通过，集群已停止。线上数据库及本地常用库未迁移。

完整单测1523通过；最终相关185测试、lint/typecheck通过（保留6个原有脚本lint警告），build通过。详见[记录](../validation/markdown-20261106.json)和[真实数据库](../validation/markdown-database-20261106.json)。不能把供应商替身当作真实Kafka、对象存储或Embedding验收。

## 上线次序

先备份→预发布验证→迁移→后端/消费者→兼容读端/编辑端→App安装包与真机验收。不能在已有Markdown后直接回退旧纯文本读端或删除格式/引用表。不要reset或重新seed生产库。

## 复现

```powershell
pnpm db:generate
pnpm lint
pnpm typecheck
pnpm exec vitest run --maxWorkers=2
pnpm build
```

以上不自动迁移。真实隔离数据库复现见[native-postgres-validation.md](native-postgres-validation.md)。新增AST依赖为MIT，锁文件已更新。
