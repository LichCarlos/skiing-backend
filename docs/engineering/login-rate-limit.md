# 登录限流：双桶事务与可信 IP

2026-11-03，D-51已获用户确认。沿用POST /auth/login；新契约1.51.0仍为143操作。精确规则见[定版协议](../../../docs/03-详细设计与接口数据/登录限流接口定版建议.md)，本轮结果见[验证摘要](../validation/login-limit-20261103.json)。

## 登录处理顺序

Origin/CSRF守卫及DTO校验成功后，HTTP层按Express可信代理链取得并规范化IP，LoginUser先调用CheckLoginAttempt，再查账号、BCrypt和创建会话。账号trim后转小写。所有通过前置校验的尝试计数，包括成功和不存在账号；成功不重置。

每账号5次/60秒，每IP30次/60秒。LoginAttemptBucket只保存BucketKey（HMAC-SHA256、CHAR(64)主键）、Attempts（1–30）、ExpiresAt（TIMESTAMPTZ(6)，索引），不关联账号或保存原始账号/IP。账号与IP采用不同HMAC域。该安全计数表不进入RAG或公开/管理查询投影。新增20261103000100_login_attempt_buckets迁移；先部署迁移再发布代码，不修改既有迁移。

PrismaLoginAttemptStore在READ COMMITTED事务中按桶键排序获取事务级advisory锁，兼容尚不存在的桶；随后FOR UPDATE读取两行，在行锁到手后读取clock_timestamp()。纯TS领域策略判断窗口：过期视作未计数，任一耗尽即返回，两边都不插入/更新；允许时在同一事务写两边，保持活动窗口原ExpiresAt。第二项写入失败时第一项回滚。锁哈希碰撞只增加串行等待，不混用桶。事务等待/执行上限分别2秒/5秒，失败进入503。

429统一返回Login rate limit exceeded及Retry-After（耗尽维度最长剩余秒数，向上取整，至少1）；不透露命中维度或账号存在性。503沿用统一异常过滤器的Internal server error包络。两种拒绝均不签发/清除认证Cookie或Token。CORS开放Retry-After响应头。Web官网、Admin及App显示通用限流反馈，维持单次提交，不自动重试登录；首期不增加倒计时或自动解锁动作。

## 环境与清理

- LOGIN_RATE_LIMIT_SECRET：独立于JWT的服务端随机密钥，至少32字节；缺失/过短启动失败，无生产默认值。所有副本必须一致。不要提交真实密钥。
- TRUSTED_PROXY_CIDRS：逗号分隔显式IP/CIDR，空值仅信任socket来源。拒绝true、数字跳数、命名网络和/0。通过Express内置可信链按最近不可信节点取IP；IPv4映射IPv6和等价IPv6写法规范化，防止换写法绕过。
- 密钥轮换会改变桶命名空间，等同重置当前限流窗口；应协调所有实例同步受控发布。代理拓扑改变也需统一配置并在实际入口验证；本地Express链测试不代表生产代理已验收。
- LoginLimitRetentionWorker启动及每分钟清理一次，每批最多1000行，FOR UPDATE SKIP LOCKED；故障只记录通用消息。停止时清除timer并等待当前批次，Prisma在应用关闭最后阶段断开。测试/契约导出不启动后台清理。

单测/框架测试使用明确的合成密钥；无数据库的旧HTTP夹具覆盖store，不改变生产阈值。数据库套件按独立密钥命名空间隔离，与实际Node子进程重启专项共用指定测试密钥。契约导出仅在工具入口生成临时密钥，不放宽运行时启动校验。Docker保持不启动/重启。

注册/刷新限流、验证码及生产入口代理部署仍是独立事项；不在首期增加字典阈值配置、解锁API或管理员查看桶接口。

## 本轮验证

独立冻结安装、142文件1220单测与8项源码导出、9文件166项HTTP/框架测试、build/编译后OpenAPI导出均通过。lint零错误，仅保留既有原生验收脚本一条no-unsafe-finally警告。真实PG17.11/pgvector0.8.1执行24迁移、双seed、测试前后db:verify，35文件839项通过。

新增9项数据库专项验证双连接池并发恰好5次、轮换账号同IP恰好30次、拒绝两边均不写、DB时间/固定窗口、连接重建、实际两个Node进程先后启动后的持久计数、成功/不存在账号计数一致、第二项写失败全事务回滚、有界过期清理。另8项HTTP专项覆盖缺密钥模块构造失败、429/503包络、Cookie保留、前置校验不计数、伪造代理头及Express链。首轮旧文章/AI夹具在固定窗口内重复登录触发31项失败，未放宽生产阈值；隔离合成测试桶后全套复验通过。两次临时数据库均已停止，日志保留。

Web2007业务+20发布+8源码工具/check及双无缓存standalone构建，App1163业务+18Node工具/check/Doctor20/20及三平台导出/88文件独立迁移校验均通过。三仓1.51.0契约SHA-256一致：4fa8529fe48872254651a095f20ce04cd7c94fe349d00e4149824bcdebfa03f8。来源与日志摘要见上方验证链接；远程CI和实际生产入口不计为已验收。
