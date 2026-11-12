# 全局雪场响应契约补齐

日期：2026-11-03。对应 API-M05，修订版本 OpenAPI **1.50.2 / 143 操作**。这是既有运行时投影的文档元数据补齐，没有新增路由、业务字段、依赖或数据库迁移。请求可空数值的上一阶段修正见 [1.50.1 记录](admin-resort-contract-types.md)。

此前全局列表、详情及写入响应缺少具体 schema，生成客户端无法表达实际数据。新增 AdminResortVO / AdminResortPageVO，沿用 MerchantResortVO 的既有固定字段，替换标签和动态字段形状，并声明 merchantId、merchantName。列表、详情、创建、编辑、发布和下架响应均引用该投影；DELETE 保持 204。全局与商家字段目录共用同一 Swagger 元数据定义，运行时字段策略保持。

评分、经纬度为可空十进制字符串；票价为 number。全局 fitTags 为 `{value,label}[]`，customFields 为 `{fieldKey,label,value}[]`；value 为 string、number、boolean、string[] 或 null，不误标 object。管理投影不继承公开雪场的收藏状态、距离或 galleryUrls，也没有新增审核意见/审核人。写入 DTO 中评分及坐标仍是数值，与响应十进制字符串分别建模。

新增真实 Nest 文档生成回归，先复现 AdminResortVO 未定义，再验证列表及各类响应引用、可空字段、联合值类型和字段目录。完整冻结安装、check、138 文件 1192 项单测、8 文件 158 项 HTTP/框架测试、build 与编译后契约导出均通过。三仓快照 SHA-256 为 `710ef0cad15dcfb363f77a9fd1463413ca0290946dda9d1c9a7fbea8e77088e0`；Web/App 独立生成类型。

HTTP/框架测试使用业务端口替身，不代替真实数据库/容器/浏览器验收；本阶段没有改变发布/下架的请求正文协议。商家资料 D-49 仍待确认，不在这 143 个操作内。Docker 按用户决定不重启。

已知差异：主契约早期接口表允许发布/下架可选 reason，但现有两个 Controller 方法没有 Body DTO，不能声称原因已被接收并随操作保存。该原因输入、校验及审计完整性仍待完成；本次响应元数据补齐不关闭这一缺口。
