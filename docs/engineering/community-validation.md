# 社区 HTTP / PostgreSQL 验收

2026-10-30 后续授权阶段：社区真实 HTTP/PostgreSQL 套件已由 36 项增至 48 项，另有既有数据库 5 项；全部写命令增加事务内授权，引用增加共享行锁。最新证据与并发边界见 [社区事务内授权](community-transaction-authorization.md)。下文 317 项等为输入边界阶段的历史完整统计。

本阶段最终验证：三仓独立冻结安装通过；Backend lint/typecheck、114 文件/704 单测、3 文件/84 HTTP 测试、21 文件/317 真实数据库测试（新增社区 HTTP/PostgreSQL 36 项）、build/OpenAPI 通过。Web 完整 check 175 项及官网/Admin production build 通过；App check 96 项、Doctor 20/20、iOS/Android/Web export 通过（Doctor 提示远程 native modules 清单获取警告）。数据库测试前后 db:verify 通过，仍为 20 迁移；无新增依赖或迁移。OpenAPI 1.38.0 三仓 SHA-256 均为 `675969590facea86c8228c2e89fc8a69ee0329f893ab0e4314ad8c1fe6fcbc6e`。

2026-10-30；OpenAPI 1.38.0，三仓快照 SHA-256：`675969590facea86c8228c2e89fc8a69ee0329f893ab0e4314ad8c1fe6fcbc6e`。分层说明见 [Community DDD](community-ddd.md)。未新增路由、依赖或迁移。

## 实现约束

- 动态正文最多 10000、评论最多 2000 个 Unicode 码点，trim 后非空；DTO 与领域规则共同限制类型/长度。
- PATCH 至少提供 content、imageAssetIds、resortId 一项；content/images 不可 null。resortId 省略保留、null 解绑、正 int4 绑定已发布雪场；创建不可 null。
- 动态/评论/雪场引用 ID 为 1–2147483647 的安全整数；图片为 0–9 项唯一正十进制 ID 字符串，不超过 signed bigint。用户已确认数量上限，DTO 与领域规则均校验，创建/编辑超过 9 张返回 400。表格 page/pageSize 为正安全整数、pageSize≤100、skip≤2147483647。
- cursor 最长 512 字符，为不带 padding 的规范 base64url；解码仅含规范 ISO createdAt 与正 int4 dynamicId。空字符串、额外字段、非法时间/ID 均 400。客户端仅回传 nextCursor。
- 审核 reason 可省略，提供时为最长 500 码点的字符串，trim 空白保存 null；显式 null 拒绝。未知请求字段由 ValidationPipe 拒绝。
- 写入与公开/本人图片读取均校验本人所有、ready、JPEG/PNG/WebP；坏关联不获签名，不返回其 URL/Asset ID。imageCount 仅计可返回图片，URL 有效期 900 秒。公开封面保留首关联槽位语义，首槽不可读则 null；本人详情沿用首张可读图片。
- 公开 feed/详情的动态、计数和本人点赞关系，以及本人列表的行/总数/点赞、本人详情/点赞，均在 RepeatableRead 快照中读取；公开动态图片签名在事务后执行。公开个人点赞关系仅匹配 active 账号；游客 false；公开 feed/详情为 private,no-store。

## 环境与执行

复用核对身份后的专用容器 linji-events-validation-20261030（pgvector/pg17，label linji.validation=events，127.0.0.1:53240），保持 20 迁移。未使用生产数据库或修改开发服务配置。

在独立 Backend 目录，显式配置专用库 DATABASE_URL 和该库初始管理员环境变量后执行：

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test:e2e
pnpm db:verify
pnpm test:db
pnpm db:verify
pnpm openapi:generate
```

`test/community-http.db-spec.ts` 使用真实 Nest、IdentityAccessModule、CommunityModule、登录/JWT、Guard、DTO、Application、Prisma 与 PostgreSQL；只有外部 AssetStorage 为签名记录器，不证明真实 S3/MinIO 通过。清理仅针对本次创建的账号、角色、动态、资产、审计与事件。

## 新增 36 项真实验收

| 范围           | 已验证行为                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| 审核与本人数据 | pending/approve/published、作者编辑复审、hidden 编辑保留、restore；本人可读非公开详情，他人读取 404、写入 403 |
| 非法输入       | 空 PATCH、null/错误类型/超长正文、未知 author/status/count、越界 resortId；状态、事件与审计不变               |
| 整数/分页/游标 | 非正数、int4 溢出、非安全整数、小数和超大 skip 均 400；非法游标 400，同时间按 ID 稳定续页                     |
| 公开过滤       | 正文搜索不区分大小写，hidden 不公开；图片拒绝 foreign/rejected/错误 MIME，手工坏关联也不签名                  |
| 图片数量       | 创建/编辑 9 张图片按顺序完整往返，第 10 张返回 400 且数据/事件不变；领域层独立拒绝超限输入                    |
| 点赞           | 顺序及并发重复 PUT 唯一、重复取消幂等、游客/本人/他人隔离、private,no-store、隐藏动态拒绝互动                 |
| 评论           | 公共只计 visible，管理含 hidden；hide/restore、本人删除、他人拒绝、隐藏父动态 404                             |
| 管理授权       | 管理入口与审核 grant 缺一拒绝；撤权后旧 JWT 下一次请求 403；无会话创建 401                                    |
| 回滚/删除      | 真实 OperationLog INSERT 失败时状态/Outbox/审计回滚；作者/管理员软删除及后续不可见                            |

社区专项包含 10 文件/93 项单测；完整后端、Web、App 检查结果登记在 README 和交付记录。新增套件已纳入既有 test:db，不依赖未归档的本机脚本。

## 未完成与证据限制

审计回滚测试从应用服务注入超长 traceId，使真实数据库列约束拒绝 INSERT；正常 HTTP trace 中间件不允许此输入。这证明事务回滚，不代替独立的 Outbox INSERT 故障注入。RepeatableRead 已在实现/适配器测试中核验，本轮未调度真实读写交错时刻。

后续阶段已在全部社区写命令中复核事务授权，并对图片/雪场引用加 FOR SHARE；Guard 放行后、事务开始前的撤权及引用/删除调度已有真实测试。授权快照之后的即时撤权、全域锁协议及生产压力仍未验，不能将此描述为所有并发情况已解决。

权威范围目录仍只有 user/role/resort/article/asset，未擅自加入 community。真实对象存储、Kafka/ClamAV/provider 复验、浏览器/设备及生产压力未完成；项目整体继续开发。
