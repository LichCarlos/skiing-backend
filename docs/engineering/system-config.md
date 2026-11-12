# 系统配置与公开品牌、政策数据

2026-11-02 分层续验：邮箱语法校验改由 Domain 策略接口、Application token 和 Infrastructure 适配器完成；生产模块及仓储直接写入均使用相同原 isEmail 语义。九个上下文的内层依赖门禁已覆盖本模块，见[DDD 检查与当前验证边界](ddd-boundary-validation.md)。现行契约为1.50.0/143操作，下方1.39.0及数据库项数为历史阶段证据，本次真实数据库复验受Docker引擎无响应影响尚未执行。

2026-10-30，用户已确认六项文本白名单、管理员乐观更新与事务审计，以及固定公开投影。协议已并入开发契约；OpenAPI `1.39.0`。不新增依赖或 migration，复用 SystemConfig 与 OperationLog。

## DDD 与数据字段

- Domain：system-config.ts 维护不可动态扩展的键、名称、默认值、Unicode 长度、邮箱及版本规则。
- Application：ManageSystemConfig 负责目录分页/搜索、DTO/VO 投影与确定性 revision；依赖 SystemConfigRepository 端口。
- Infrastructure：PrismaSystemConfigRepository 在事务内读取当前授权并保存值/版本/审计，Controller 只处理输入、HTTP 与错误映射。

ConfigKey 是六个 `site.*` 键之一。Value 虽沿用 JSONB 列，首期 API 只写 JSON 字符串，不能保存任意 JSON。目录名称/类型/长度/默认值来自代码，不读取历史 Description 作为可执行配置。Status 在此接口中不开放编辑，保存有效内容时设为 active。Version 是数据库正 int4；未保存的目录项虚拟返回 0、updatedAt/updatedByUserId 为 null，首次保存写 1。

遗留 inactive、错误 JSON 类型或不符合当前规则的值使用公开默认/null；保留真实版本与维护元数据供管理员修复，不能用 version=0 覆盖历史记录。没有创建、删除、任意键编辑或密钥接口。

## 权限、一致性和公开读取

管理列表需要 system_admin、management:portal:enter、system:config:list；保存改为 system:config:update。仓储在事务内重新解析当前账号与角色/权限，拒绝混合 system_admin、失效主体和仅拥有同名 grants 的自定义角色，并验证 SystemRoleCode。此为事务授权快照，不承诺授权快照之后即时撤权取消已经执行的命令。

更新使用 Serializable 事务与 expectedVersion 条件。首次保存唯一竞争、P2034 并发冲突均返回 409；不自动重试覆盖他人内容。版本、值、维护者与 OperationLog 同事务。审计仅保存键与前后版本、操作者和请求元数据，不保存政策或联系正文；审计 INSERT 失败时业务修改回滚。最大 int4 版本不再递增，返回 409。

`GET /public/config` 无需登录，只按固定六键读取，投影为 siteName/tagline/about/contactEmail/privacyPolicy/termsOfService/revision，不返回数据库行、维护者、内部键、环境变量或非白名单历史记录。revision 为有序键/版本对的 SHA-256；API 写入始终增加版本。公开响应与管理读取使用 no-store，前端每次页面访问重新读取。本模块没有缓存更新或其他异步副作用，因此不产生新的 Kafka 事件；它也不会自动将政策正文加入 RAG 索引。

JSON 请求体预算设为 512 KiB，覆盖 30000 Unicode code point 正文（含较大的 emoji 文本与 JSON 转义）；各 DTO/领域长度规则继续独立生效，multipart 资产仍使用原专用限制。

## 验证与边界

- 21 项领域/应用单测：六种长度、Unicode、邮箱、运行时类型、版本、分页、默认与遗留数据公开投影。
- 21 项真实 HTTP/PostgreSQL：游客/自定义角色拒绝、默认目录、公开白名单、非法输入、更新/首次创建并发、版本冲突、事务内撤权复核、实际审计 INSERT 失败回滚、未配置/失效遗留值、30000 emoji 正文。
- HTTP 契约测试额外断言三条路由、UpdateSystemConfigDto 和 PublicSiteConfigVO；Web/App 使用各自快照生成类型。

数据库专项在已迁移且白名单尚无保存记录的专用库运行；若存在预先配置则主动失败，不删除或覆盖既有数据。测试仅清理自己账号维护的数据，不 reset schema。

Web 8 项管理 transport/验证/权限测试与 4 项公开政策 SSR 测试，App 3 项 transport/文本测试；这些不等同于浏览器交互或真机验收。政策以纯文本显示，多段按换行保留，不解释 HTML；未配置显示“尚未发布正式内容”，不填造法律主体或联系方式。正式内容仍需运营方提供后由管理员保存。

完整阶段统计见各仓 README 与测试记录。界面实施见 Web/App 各自工程说明；浏览器/设备、真实供应商、全域并发授权及 AI 管理仍未完成。
