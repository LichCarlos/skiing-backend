# 公开内容编译服务与隔离数据库验收

2026-11-03 管理授权联调阶段将临时集群/服务生命周期提取到本仓scripts/native-http-runtime.ts，public入口、专用库及夹具保持；新增管理授权独立入口见[工程说明](admin-authorization-http-validation.md)。共用的是Backend本仓验收基础设施，不跨仓启动客户端；本阶段另外以新临时库回归公开内容八项。

日期：2026-11-03。负责人：Backend。状态：本次运行成功。没有新增业务 API、依赖或迁移，沿用 OpenAPI 1.50.2 / 143 操作。

## 本仓入口与隔离条件

新增 [test:native-public-http 脚本](../../scripts/validate-native-public-http.ts)与[专用夹具](../../scripts/public-content-http-fixture.ts)。Windows PostgreSQL 17/pgvector 的准备方式及下载来源见[既有说明](native-postgres-validation.md)。本仓先执行 pnpm install --frozen-lockfile、pnpm check、pnpm build，再设置 LINJI_NATIVE_PG_ROOT 与 LINJI_NATIVE_PG_OUTPUT，运行 pnpm test:native-public-http。

脚本要求两个显式运行路径并解析为绝对路径，不接受已有 DATABASE_URL 或数据目录；实际使用 mkdtemp 创建数据目录、随机 SCRAM/初始管理员/JWT 凭证与空闲端口，创建 linji_public_content_validation 数据库。执行迁移、双 seed、结构校验和合成夹具后，启动本仓 dist/main.js。PostgreSQL 仅回环监听；HTTP 仍使用生产 main 默认监听方式，测试调用地址为回环。环境 NODE_ENV=test 并显式禁用 Outbox/Kafka worker，不启动 Docker、模型、扫描器或对象存储。

ready.json 只包含 HTTP 地址与合成资源编号，没有数据库连接串、管理员或存储密钥。脚本不读取、安装或启动其他仓库。其他 HTTP 客户端完成验收并退出 0 后，验收人员将 passed 写入该次目录的 stop.request；该文件不是自动验证证据，必须保留客户端测试结果。脚本继续执行持久断言与 db:verify，然后关闭本次子进程和本次数据目录。

夹具核对真实 current_database()、新 seed 的账号数量与空业务表，随后才建立公开/非公开记录。数据含 ready 图片元数据但没有对象内容；生产 S3 适配器生成本地签名无需网络，不能据此声称存储、上传或扫描通过。额外校验源记录计数、读者两项收藏所有权、退出后的无有效会话与无 Outbox 写入。

正常退出、超时或失败均进入 finally，只停止当前脚本持有的 Node 子进程和 mkdtemp 数据目录，不结束全局服务，不递归删除。Windows 终止子进程不证明生产 OS 信号排空。若宿主强杀导致 finally 未执行，人工恢复只能核对该次 report/data 路径，不能按进程名称结束其他项目。

## 当前证据

末次目录 D:/linji-public-live/20261103/runs/linji-public-http-nrXLFC。PostgreSQL17.11，数据库端口60707、API端口49656；23项迁移、双seed、前后db:verify与fixture-verify均通过。独立Web套件使用生产HTTP客户端/读取器连接实际Nest服务，8项通过，验证详情VO/404/公开字段/评论分页/收藏隔离/元数据。首轮esssiU亦成功并停止；末次为Web统一本端配置入口、收紧隐藏动态评论404断言后使用全新库复验，保留两轮日志。

report.completed、report.stopped、report.serverStopped全部true；两端口无监听、postmaster.pid与初始化密码文件不存在。测试业务数据与诊断日志留在本次隔离目录，未写入既有库。未重新执行既有830项完整数据库套件，本次是8项新增HTTP联调与专项持久断言，不能相互替代。

本仓冻结安装、完整check（138文件1192单测）、8文件158项HTTP/框架测试、build及编译后契约导出通过。新增脚本已纳入lint/typecheck；保留既有validate-native-postgres.ts的no-unsafe-finally警告。日志public-live-保留。没有生产Next/Expo启动、浏览器、设备、容器或真实供应商验收；整体项目继续进行。
