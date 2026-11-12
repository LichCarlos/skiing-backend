# 自定义字段的 OpenAPI 类型

日期：2026-10-31。本阶段只修正 Swagger 元数据，并增加真实HTTP/PostgreSQL回归；数据库和运行时业务协议保持原状。OpenAPI升级为1.44.0，无新增路由、依赖或迁移。

Nest 对初始化属性和 unknown/可空联合类型的反射把字段创建 sortOrder、五项布尔标记、optionsDictType 和 defaultValue 错误推断为object，导致下游生成 Record<string, never>。本阶段显式声明 Number/Boolean/String，并为创建与更新的defaultValue复用现有VO使用的JSON oneOf（string、number、boolean、object、array、null）；同样修正字段列表page/pageSize和分组创建sortOrder的数字元数据。

HTTP/OpenAPI测试断言这些类型、默认值和JSON分支。真实数据库新增3项：整数0、布尔false保存后在HTTP和仓储读回保持值；编辑省略defaultValue/validation保留旧值，显式null清除defaultValue/validation/optionsDictType。字段配置真实专项现26项；完整数据库26文件/542项、单元118文件/851项、HTTP3文件/88项、lint/typecheck/build和前后db:verify通过。验证库保持20迁移，测试夹具已清理，既有管理员与待处理事件保留。

三仓相同快照的SHA-256为 `98baf03cc01588729adc9581fce4980a7eca8855b91e03fc37a9aa8a51d99cc2`，Web/App各自在本仓生成类型。审计导出差异确认仅上述schema/查询参数类型和版本变化，端点集合不变；路由存在性仍为133项中129项存在，待定版的工作台汇总和RAG来源运维3项未实施。日志field-console-*.log保留，UI/真实供应商与项目整体验收未完成。
