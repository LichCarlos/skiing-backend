# App 知识列表真实 HTTP 与持久化验收

2026-11-02 文章详情续验：既有夹具和协议用于App新增详情/收藏四项，连同列表三项共 **7项真实HTTP通过**。后端产品代码、接口、migration未变；Backend完整130文件1039项/check/build及三仓冻结安装通过，App918项/Doctor20/20/三平台导出和Web1459项/双缓存构建通过。下文原三项记录保留其阶段范围。

当前新增证据：完整公开正文/作者/分类与草稿、撤回、软删、停用分类四类404；实际204收藏PUT提交后丢响应不重放，读取真值后显式DELETE；QueryClient账号缓存失效；同账号重登录旧读/收藏在请求前拒绝；真实详情响应延迟至新登录后被拒绝。只有Native SecureStore使用内存替身，无伪造API成功。18篇文章数量、3账号及最终2条各自收藏持久断言再次通过；23迁移/双seed/前后db:verify通过。未重跑完整历史数据库/HTTP套件，无浏览器或设备新增结论。

本轮沿用下方独立复现步骤和专用库名，数据库/API端口分别为62961/62960；日志前缀 `article-detail-`。验证后已核实并清理API PID16576、容器 linji-article-detail-20261102 和匿名数据卷，原五个无关容器保留。客户端用例见其独立仓库 `test/knowledge-list.http-spec.ts`；后端仅提供非凭证清单、API和持久断言，不导入客户端源码。

2026-11-02；API-K01/APP-06既定契约续验。后端产品实现、OpenAPI1.50.0/143操作、依赖和23项migration未变，仅增加本仓可销毁夹具与持久断言脚本。

三仓冻结安装通过；Backend完整130文件1039项/check/build通过，App独立真实HTTP三项通过。实际transport/auth/session经编译后的Nest连接PostgreSQL17/pgvector；仅Native SecureStore替换为测试内存存储，未用虚构API响应替代查询。新库23迁移、双seed、前后db:verify通过；本轮未重跑完整历史数据库/HTTP套件。

## 场景

夹具创建18篇文章：14篇公开，另外草稿、撤回、软删除和停用分类各一篇。公开时间相同以验证ArticleId倒序，客户端按12+2偏移分页，第三页为空。分类启用且其类型显式公开；分类列表不返回停用项。标题/摘要匹配不区分大小写，`%_`按字面量匹配；分类与关键词取交集。

App通过正式注册/登录和收藏接口创建两个账号及不同收藏，验证本人标记、他人标记为false，同账号重登录后旧epoch无请求。后端verify额外断言18篇文章不变、3个账号（含seed）、恰好2条各自所有的文章收藏。完整动态、收益、AI、Kafka或设备流程不在此专项范围。

## 独立复现

在本仓按README冻结安装、生成Prisma并check/build。新建自己的空PostgreSQL17/pgvector数据库 `linji_knowledge_list_validation`，仅绑定回环62941。设置专用DATABASE_URL、合成INITIAL_ADMIN_ACCOUNT/INITIAL_ADMIN_PASSWORD，执行 `pnpm db:deploy`、两次`pnpm db:seed`和`pnpm db:verify`。然后执行：

```powershell
$env:KNOWLEDGE_LIST_FIXTURE_CONFIRM='linji_knowledge_list_validation'
pnpm exec tsx scripts/knowledge-list-http-fixture.ts prepare
```

[脚本](../../scripts/knowledge-list-http-fixture.ts)要求回环数据库主机、专用库名、显式确认值，且仅有seed账号/文章为零。准备合成分类和文章并写本仓忽略的 `storage/knowledge-list-http-fixture.json`，不持久化密码。启动编译后API：

```powershell
$env:PORT='62940'
$env:JWT_ACCESS_SECRET='<至少32字符的临时随机值>'
$env:OUTBOX_DISPATCH_ENABLED='false'
$env:KAFKA_CONSUMER_ENABLED='false'
node dist/main.js
```

给App负责人提供回环API地址、清单JSON及临时合成用户密码；其在独立仓库执行`pnpm test:knowledge-list-http`，不导入本仓代码、不连接数据库。完成后本仓使用相同DATABASE_URL、确认值及seed环境执行：

```powershell
pnpm exec tsx scripts/knowledge-list-http-fixture.ts verify
pnpm db:verify
```

重复或失败重跑需重建空专用库，不能清空业务库。结束后只停止自己的API/容器和卷。本仓忽略 `knowledge-list-*.log` 及 `storage/` 清单。真实模型、对象存储、生产消息投递、原生设备和Expo Web Cookie认证不在本轮范围。

本轮API PID39800及专用容器/数据卷已按身份核实清理，62940/62941无监听，原五个无关容器保持。
