# 字段组详情接口

日期：2026-10-31。API-M10 原路由表已包含 `GET /admin/custom-field-groups/:entityType/:groupKey`，本阶段补齐遗漏实现，OpenAPI 升至 1.43.0。没有新增业务协议、依赖或数据库迁移。

Controller 使用管理入口与 `system:field-group:list`，返回已有 `CustomFieldGroupVO`，不内嵌字段定义。自定义角色可通过 grants 获得读取能力，不要求商家或其他固定角色键。每次请求重新读取有效权限，入口或动作权限被撤销后，原 access token 不再允许该请求。

应用层先校验四类实体白名单与分组键 `^[a-z][a-z0-9_-]{0,99}$`，非法输入返回 400，再调用既有仓储端口。仓储以 EntityType_GroupKey 复合唯一键查询；合法但不存在的分组、同键只存在于其他实体时返回 404。停用分组仍允许管理读取，不改变公开 schema 或 RAG 的活动分组过滤。匿名返回 401，缺少管理入口或查询权限返回 403。

读取不执行配置变更、审计或 Outbox 写入；既有修改与停用的事务审计规则保持适用。三仓快照相对 1.42.0 仅新增此 GET 操作与版本号，既有 schemas 不变；Web/App 各自在本仓生成类型，页面没有在本阶段改动。

应用层字段配置专项现为12项，真实HTTP/PostgreSQL字段配置专项为23项；新增8项应用层测试与12项数据库测试覆盖复合键隔离、停用读取、参数边界、匿名/无权拒绝、可配置角色、两类实时撤权和只读无审计/事件副作用。完整回归：Backend lint/typecheck、118文件/851单测、3文件/88 HTTP、26文件/539数据库测试及build/OpenAPI通过；Web完整check349项及双应用build通过；App check183项、Doctor20/20与三平台export通过。三仓分别冻结安装，验证库前后db:verify通过，保持20迁移。测试日志保存在各仓根目录的 field-group-detail-*.log；App 导出保存在 dist-field-group-detail-validation/。这次接口补齐不代表全项目、浏览器、设备、真实模型或存储供应商已经验收。

三仓 OpenAPI 1.43.0 的 SHA-256：`1afa52dde8d8ffdd36943a95478076cdbbfc8b29c2d9a1b57c4a7c8fa33827f6`。静态展开契约 API 路由表共133项，本轮129项存在、4项缺失（全局工作台汇总及RAG来源运维三项）；存在性不等同于行为或验收通过。

初轮测试角色缺少必需的 DataScope，类型检查和数据库夹具初始化失败，已补齐为 all 并保留初轮失败日志；业务代码不使用该值绕过字段组权限。正式回归结果以最终日志为准。
