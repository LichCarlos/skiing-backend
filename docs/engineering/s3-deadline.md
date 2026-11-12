# S3运行时请求时限与失败状态验证

2026-11-03启动本轮，负责人Backend，验证完成UTC时间为 2026-11-03T16:09:24.696Z。现有资产API内部修复，OpenAPI1.51.1/143操作、24迁移保持。Web/App业务代码未改。

## 时限与重试

原S3AssetStorage每次创建SDK client，但没有为send传入显式总时限。存储端不返回响应头或持续发送不完整错误正文时，请求可能长期占用上传/删除链路。

现在S3_REQUEST_TIMEOUT_MS默认30000ms，必须是1至2147483647的安全整数；非法值在PUT/DELETE建立网络连接前503。每次运行时PUT或DELETE创建自己的AbortSignal，覆盖该操作的连接、传输、响应处理，并在finally销毁client。不同操作不共用时限，15分钟URL签发仍离线进行，保持S3_PUBLIC_ENDPOINT与900秒参数。

实际安装 @aws-sdk/client-s3 3.1156.0、@smithy/core 3.36.2、@smithy/node-http-handler 4.12.1。查阅安装的retry/index.js发现cooldown直接等待setTimeout，不能由请求AbortSignal打断；真实HTTP Retry-After=2秒的回归复现配置180ms但约2秒后才失败。因此运行时client固定maxAttempts=1，不使用SDK隐式重试。首个服务错误立即交还应用层，不会等待Retry-After或发起第二次SDK尝试。上传失败后的既有补偿DELETE是独立操作，仍有自己的一次尝试和时限。本次没有改变storage:init的独立CLI实现。

这是一项运行时配置，启动前可在后端.env或部署环境设置；生产按存储网络/10MiB上限调整。前端不读取该变量，不接触S3凭证。总时限不是整个上传/数据库/补偿流程的共同预算，Node计时器也不能抢占阻塞的事件循环。

## 数据与接口行为

扫描通过但PUT失败或超时，沿用现有应用服务：Asset标为rejected，不签发读取URL，尝试删除同一个私有key，接口503。即使客户端中止，远端仍可能已提交；补偿删除也可能失败，不能承诺所有异常下物理文件立即不存在。

本人DELETE在逻辑停用后遇到物理删除错误，按既有协议503；管理员DELETE完成同事务逻辑停用/审计后忽略物理错误并204。两种记录均为deleted，后续资产读取404。此次只界定等待，不改变该响应差异，也不新增物理清理队列、自动恢复或重试协议。待删除对象可能仍在存储服务中，逻辑停用不能当成物理删除验收。

## 验证

新增14项真实HTTP/SDK回归：签名PUT/DELETE、公共端点离线900秒URL、两种操作的无响应头及持续零碎错误正文、并发独立时限、5种非法配置，以及两种操作的Retry-After单次尝试。失败证据保留：首次12项10失败/2通过；首个AbortSignal修复后新增两项Retry-After仍失败（14项2失败/12通过）；单次尝试配置后两个旧断言将HTTP正文中止错误固定为AbortError，SDK实际返回ECONNRESET，改为验证中止消息、attempts=1与连接关闭，专项103项通过。最初三仓检查点Backend1269单测通过，补充两项后再次独立冻结安装/完整check/HTTP/build得到最终1271，未合并计数冒充同一次结果。

新增3项真实认证multipart HTTP/PostgreSQL回归：PUT已在协议夹具提交但响应卡住，503/rejected且不签名、一次补偿DELETE清理同键；本人DELETE物理失败503、管理端逻辑停用204及审计，均持久deleted且随后404，既有业务行为保持。新建隔离Windows PostgreSQL17/pgvector集群，24迁移、双seed、前后verify和完整845项数据库测试通过，集群停止/端口关闭/密码及pid文件清理另行核对。网络使用真实AWS SDK/HTTP协议夹具，不等于真实MinIO/S3或ClamAV。

三仓独立冻结安装/check及构建通过：Backend最终1271单测+8工具、173HTTP框架及build；Web3045业务+28工具、官网/Admin双强制构建与standalone校验；App1217业务+18工具、Doctor20/20、三平台导出/导出后类型及88文件封存迁移验证。

日志、源码、安装SDK与数据库清理摘要见[三仓验证报告](../validation/s3-deadline-20261103.json)。实际HTTP对端是本机协议夹具，不能替代真实MinIO/S3签名验证或病毒库；历史外部服务结果见[MinIO/ClamAV记录](minio-source-storage.md)。扫描器总时限是[上一轮单独修复](scanner-deadline.md)。

OpenAPI1.51.1/143操作与24迁移保持，无接口、数据库或依赖变更。总时限按单次PUT/DELETE计算，不是完整上传事务的统一预算；事件循环阻塞不能被Node计时器抢占。超时不证明远端未提交，补偿可能失败，逻辑停用不等于物理清理成功；单次失败现在立即交还应用层。真实MinIO/S3/ClamAV、本轮Kafka、浏览器/设备、供应商/Embedding、容器/签名包及远程CI仍待验；Windows Kafka AccessDenied未解决，35秒用例未运行，D-49/D-50/D-09保持待决。未启动/重启Docker或借用其WSL，整体目标未完成。
