# App雪场列表与收藏真实HTTP夹具

2026-11-02 雪场详情/本人收藏续验：既有夹具和生产协议不变，App套件从3项扩为 **8项真实HTTP通过**。新增完整公开详情与pending_review详情404、本人收藏20+2分页/类型筛选/显式取消/跨账号隔离、同账号重登录旧操作在HTTP前拒绝，以及真实详情/收藏响应延迟至新登录后被拒绝且不再触发后置身份读取。仅Native SecureStore为替身，未模拟API成功响应。当前App新增80项，完整56文件998项/Doctor20/20/三平台导出通过；下文635/三项均是原阶段事实。

本轮复用下方独立步骤，在回环62971创建PG17/pgvector库`linji_resort_list_validation`，23迁移/双seed/前后db:verify通过；API62970使用本仓编译产物。verify再次断言两账号分别仅一条不同雪场收藏；cleanup核对清单后只删模拟记录，最终保留seed账号1个，雪场/收藏/会话0。本仓冻结安装/check/130文件1039项/build通过，Web1459项/check及两个应用缓存构建通过。无业务、OpenAPI、依赖或migration变更，未重跑完整历史DB/HTTP/Kafka套件。

API PID11004（父6844）及容器`e9fe56701adda7d4c929603238ce7e9222c33c661fbf781f0f8c5f86b2c2cae8`，名称`linji-resort-detail-20261102`/标签`linji.validation=resort-detail-20261102`，均核对后清理；匿名卷`8d30ba2cae755d6d7d9129a8b84f981ccc5ca0a9d5548be872e9b83427bfe173`及临时凭证已删除，62970/62971无监听，原五个无关容器保持。日志前缀`resort-detail-`，App导出为D:/linji-resort-detail-mobile/export-20261102。实际浏览器/设备、供应商、生产恢复和远程CI仍待验，无提交/推送/部署。

2026-11-02，OpenAPI1.50.0保持。仅新增`scripts/resort-list-http-fixture.ts create|verify|cleanup`，不改生产业务/API/schema。只允许loopback库`linji_resort_list_validation`，要求`RESORT_LIST_FIXTURE_CONFIRM=linji_resort_list_validation`；create还要求只有seed账号1个且雪场0个，不覆盖已有清单。

本仓配置专用DATABASE_URL、INITIAL_ADMIN_ACCOUNT/PASSWORD，运行`pnpm db:deploy`、两次`pnpm db:seed`、`pnpm db:verify`，再设置`RESORT_LIST_FIXTURE_PASSWORD`运行`pnpm exec tsx scripts/resort-list-http-fixture.ts create`。以BCrypt创建两个registered_user账号；在事务内创建22个published雪场、1个pending_review雪场和3个临时标签。所有资产为空，不需要对象存储。忽略入库的storage清单只含模拟ID/账号/标签和是否创建字典类型，不保存密码或令牌。

独立启动Nest编译产物，关闭OUTBOX_DISPATCH_ENABLED/KAFKA_CONSUMER_ENABLED；仅把API地址、清单JSON和模拟密码交给App。App本仓设置`EXPO_PUBLIC_API_BASE_URL`、`RESORT_LIST_FIXTURE_JSON`、`RESORT_LIST_FIXTURE_PASSWORD`后运行`pnpm test:resort-list-http`。App不导入后端源码、不直连数据库。该套件用真实QueryClient、FavoriteRun/端口、API/auth访问Nest/PostgreSQL，仅Native SecureStore为替身。

本轮三项通过：游客公开标签/隐藏雪场、全包含筛选、零距离和20+2分页；重复明确收藏不反转、取消后再添加、列表真实重读和跨用户/旧epoch隔离；真实204后注入响应丢失/详情503，所有新收藏被门禁阻断，恢复后只读核对。`verify`确认每个用户仅一条不同雪场的收藏，不存在跨账号目标。请求丢失/503由客户端可控注入，真实成功写入并未被模拟。

使用新建pgvector/pg17 AutoRemove容器linji-resort-list-validation-20261102，ID`ea6680fd02796abdf598bce0f1291867c163bf3df0c689ce2a73db03c60a68d2`，数据库仅127.0.0.1:62303，Nest端口62313；23迁移/双seed及前后db:verify通过。cleanup先核对账号/ID，再只删清单雪场、标签、模拟账号与审计；仅在夹具自行创建字典类型时删除该类型。最终User1、SkiResort/Favorite/AuthSession0，原seed和原字典保留。本轮Nest和经ID/标签/AutoRemove核实的容器已停止，其余5个容器未操作。

本仓冻结安装、lint/typecheck、130文件1039单测和build通过。未重跑完整823数据库/126HTTP/真实Kafka套件；历史数量不当成本轮结果。日志resort-list-flow保留并忽略入库，无生产部署、提交或推送。原生设备、完整浏览器/Expo Web认证、供应商和生产恢复仍待验。
