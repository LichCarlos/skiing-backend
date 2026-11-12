# 项目知识来源链接契约校正

日期：2026-11-01。对应 API-M07。ProjectKnowledgeWriteDto.sourceUrl 是可选 string|null；继承的 UpdateProjectKnowledgeDto 同样适用。已有运行时规则只允许有效HTTP(S)来源，并校验长度、userinfo和敏感文本，本轮未改变业务规则、路由、权限、事务或迁移。

Swagger 对联合类型未明确指定类型时误导出 object。现使用 `@ApiPropertyOptional({ type: String, maxLength: 2048, nullable: true })`，创建和更新的 sourceUrl 均导出 nullable string。OpenAPI升为1.46.0；相对1.45.0仅版本号和两个DTO的sourceUrl.type变化。快照SHA-256为 `e18e8cd888793a76fac80c6be22161f930485694a7eac95c42f8865439d52de6`。

HTTP测试新增两个DTO的字段形态断言，原有版本断言同步升级。首次HTTP回归有8项旧版本断言失败，失败日志保留；最终结果见README最新记录及 knowledge-pages-http-final.log。业务单测及真实数据库授权/版本/Outbox测试继续保留。事务授权和并发边界见 [知识写入验收](knowledge-write-validation.md)。

Web与App各自复制相同快照、更新本仓锁文件并生成类型，不引入跨仓源码依赖。客户端类型修正不代表真实浏览器/API/供应商验收完成；RAG异步索引的完成状态亦不由知识写入响应承诺。
