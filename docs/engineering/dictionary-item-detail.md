# 字典项详情与边界校验

日期：2026-10-31。API-M09 的原始路由表已包含 `GET /admin/dictionaries/:dictType/items/:itemId`，本阶段补齐遗漏实现，OpenAPI 升至 1.42.0。没有新增业务协议、依赖或数据库迁移。

Controller 沿用管理入口和 system:dict:list 授权、ParseIntPipe 与 DictionaryItemVO。应用层先校验正 int4 ID，再按 dictType 读取既有管理字典树并查找指定节点，返回该节点和按既有规则排序的 children 子树，不包含兄弟节点。类型不存在或 ID 不属于该类型均返回 404。停用类型与停用项继续允许管理员读取，以支持维护和恢复；公开/RAG 可见性规则不受影响。

仓储仍负责按类型读取，应用层负责节点选择，不向 Controller 暴露 Prisma。详情不写 OperationLog 或 Outbox，写操作仍按既有事务审计与事件协议执行。共享 ID 校验同时收紧 PATCH/DELETE 的 int4 上界，避免把超范围数字传入 PostgreSQL。

应用层专项13项、真实 HTTP/PostgreSQL 字典专项43项通过。新增覆盖嵌套子树、缺失/跨类型节点、匿名与普通用户拒绝、自定义授权角色可读、实时撤权、停用记录、读操作无审计/事件副作用，以及非法和溢出 ID；OpenAPI HTTP 测试核对整数路径约束和既有 VO 引用。数据库专项包含此前的引用/防环、审计/Outbox 回滚及真实 pgvector 重建测试，Embedding 使用替身，不等同于真实模型或 Kafka 验收。

三端同步的 1.42.0 快照相对 1.41.0 仅增加该 GET 操作和 info.version，既有 schemas 不变。完整回归以仓库根 dictionary-management-* 日志为证据。浏览器点击、性能/大规模树与真实供应商验收仍待完成。
