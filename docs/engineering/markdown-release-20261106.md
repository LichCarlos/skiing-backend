# 富文本后端生产部署 · 2026-11-06

北京时间16:16，API <https://lichcarlos.top/snow-api/api/v1> 已切换 `/opt/linji/releases/20261106-markdown/backend`，OpenAPI1.53.0/151操作。此前本地实现“未部署”为历史状态。

冻结源码 `a047ad156e53b414d56874c1fd199aaaf21859a4ac3d340189296550fdf891bf`，929文件；外部Linux冻结安装、类型检查、Nest生产构建完成。Prisma在构建临时schema生成时加入服务器 `rhel-openssl-1.1.x` 引擎，不改变业务schema。迁移工具在服务器复用同版本RHEL schema engine。

先在 `/opt/linji/private/backups/20261106-markdown` 保存PG17原生格式备份、恢复目录、MinIO和unit备份，再真实恢复到克隆库。新增迁移 `20261106000100_article_markdown_assets` 在克隆及生产执行并verify通过，累计26迁移；没有seed、密码或权限重置。

迁移后原8文章、20动态、5雪场、17账号、34资产完全保留，旧正文仍plain_text。13项克隆库真实HTTP/存储/ClamAV检查覆盖Markdown写入/发布/审核、资产绑定与公开URL、CAS、协议安全与删除保护；未向生产业务库写合成内容。测试对象已按API解除引用并删除，克隆库/候选环境已清理。

服务仅重启linji-api、linji-web、linji-admin，其他服务器服务PID/状态未变。生产新Markdown尚未产生，**本次没有验证新Markdown经过真实Kafka/embedding到向量索引的全链路**；不混淆克隆测试与生产证据。

故障恢复保留新schema与内容读取；若有Markdown写入，不可盲退旧API或删新增列/表。数据库备份恢复另需维护窗口及数据损失评估。前端回滚脚本不做数据库回退。

[结构化报告](../validation/markdown-release-20261106.json)。原始证据 `D:/linji-local/20261106/markdown-release`，线上迁移/激活报告保留于发布目录；密钥未入源码或下载。
