# MinIO源码构建与真实私有存储验收

维护：Backend；查阅日期2026-11-02。范围：API-ASSET-01/02的开发基础设施和真实存储验证。OpenAPI1.50.0/143操作、产品接口、数据库模型和Node依赖保持。固定源码镜像构建和Compose冷启动、桶重复初始化、真实存储专项已通过。测试明细与限制见下文；早期资产/发布编辑阶段的存储替身证据保持其历史范围。

## 固定源码与构建

原Compose引用`minio/minio:RELEASE.2025-09-07T16-13-09Z`，官方Docker Hub元数据现为404。MinIO[官方README](https://github.com/minio/minio/blob/9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a/README.md)说明社区版采用Source-Only Distribution；本仓改用官方`RELEASE.2025-10-15T17-29-55Z`，提交`9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a`。不是将存储替换为协议模拟器。

[Dockerfile](../../infra/minio/Dockerfile)固定官方Go1.27.3构建镜像digest、官方源码归档SHA-256 `45521908307306e925c98d629e1c17d78c8b72b6ee242b1bfb1409f7d8ee5841`，并使用该提交的go.mod/go.sum。Go仅用于第三方服务镜像构建，产品源码仍为TypeScript；开发者不需要在主机安装Go。镜像含上游LICENSE、源码revision标签，以UID10001运行，使用独立/data卷；不将外部源码或二进制提交到本仓。

```powershell
docker compose --env-file .env -f infra/docker-compose.yml build minio
docker compose --env-file .env -f infra/docker-compose.yml up -d
pnpm storage:init
```

Compose从源码构建本地`linji/minio:source-9e49d5e7a648`，不依赖原MinIO/mc预编译镜像。`storage:init`读取本仓.env或进程环境，用现有AWS SDK检查/创建S3_BUCKET，重复执行不会清空对象或覆盖访问策略。新桶默认私有；现有桶策略由原负责人维护，不能把初始化输出当成既有策略安全审计。启动重试有上限；鉴权/参数类4xx立即失败，不无限重试。

本轮默认`proxy.golang.org`在Docker内下载模块出现connection refused/DNS失败；改用goproxy.cn后部分下载unexpected EOF，Docker默认代理也未能连接上游。最终先用临时Go容器curl确认主机系统代理可达官方模块服务，再显式传入Docker构建代理成功；保留go.sum、TLS与Go校验数据库验证。代理只作用于构建，不写入运行镜像或产品配置。CI默认用官方Go代理。

```powershell
# 仅当构建环境确需代理时，替换为本机已验证的地址；不要复制凭证进Dockerfile。
docker build --build-arg HTTP_PROXY=http://host.docker.internal:7892 --build-arg HTTPS_PROXY=http://host.docker.internal:7892 -t linji/minio:source-9e49d5e7a648 infra/minio
```

`MINIO_BUILD_GOPROXY`可配置其他模块代理，默认官方值不变；它不能修复Docker本身的联网/代理故障。首次构建会下载Go依赖，后续BuildKit缓存可复用。源码构建镜像ID为`sha256:5270d5208fdc42c53007ecc5ab727f880fe293700e21455f9ba936be030a87bf`，大小109566708字节；实际运行版本/commit与固定源码一致。

Compose的MinIO API/Console默认仅绑定127.0.0.1，可显式配置`MINIO_BIND_ADDRESS`。新空卷冷启动已用UID10001实际验证；已有MinIO数据卷需保持原数据和正确写权限，不能为解决权限错误删除业务卷。生产S3端点、TLS、密钥、服务账号和备份按部署环境配置；本仓源码镜像是当前开发环境基线，不代表云对象存储生产验收。

## 独立真实存储专项

使用自己的空PG17/pgvector库`linji_asset_storage_validation`、真实MinIO和真实ClamAV，仅绑定回环。执行23迁移、两次seed与db:verify；指定以下环境后运行：

```powershell
$env:ASSET_STORAGE_INTEGRATION_CONFIRM='linji_asset_storage_validation'
$env:S3_ENDPOINT='http://127.0.0.1:63002'
$env:S3_PUBLIC_ENDPOINT=$env:S3_ENDPOINT
$env:S3_BUCKET='linji-asset-storage-validation'
$env:S3_REGION='us-east-1'
# S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY、DATABASE_URL、JWT_ACCESS_SECRET
# 及CLAMAV_HOST/PORT使用专用测试环境值，不提交凭证。
# 仅专用测试扫描器：装载无害标记定义并通知重载。
docker cp test/fixtures/linji-test-only.ndb '<dedicated-clamav-container>:/var/lib/clamav/linji-test-only.ndb'
docker exec '<dedicated-clamav-container>' clamdscan --reload
pnpm storage:init
pnpm storage:init
pnpm test:storage-integration
pnpm db:verify
```

[十项测试](../../test/assets.storage-integration-spec.ts)装配真实IdentityAccessModule/AssetsModule，无仓储、Storage或Scanner端口替换，HTTP使用真实Nest路由和数据库：multipart上传经实际扫描后保存；签发900秒读取URL并下载相同图片字节；匿名读取、篡改签名/路径与过期签名被存储拒绝；他人404；公网host与内部endpoint不同仍可签名下载；头像引用保护；重复初始化保留对象/私有访问、错误凭证初始化失败且不破坏数据；无害自定义签名命中的图片被拒绝且不产生对象；删除后主库软删除、对象实际移除且旧URL失效。

先前将标准EICAR字符串追加到PNG的夹具假设有误，真实ClamAV未报感染，测试返回201而非422。本轮未修改生产检测规则；改按[官方扩展签名格式](https://docs.clamav.net/manual/Signatures/ExtendedSignatures.html)提供[无害测试标记](../../test/fixtures/linji-test-only.ndb)，仅装载到专用测试容器。真实clamd加载完整数据库需约18秒，首次5秒等待不足；测试现使用有上限的实际标记探测等待，未跳过检测。原标准EICAR裸文件/干净PNG/并发/扫描不可用五项真实扫描专项仍独立执行。该自定义标记仅证明检测与拒绝链路，不是恶意样本覆盖；测试容器使用镜像自带旧定义，生产ClamAV仍启用签名更新。

测试限定专用数据库名、回环主机、独立桶名及显式确认值，要求测试桶初始为空；只清理本次生成账号/资产及对象，不清空其他数据。配置为单独`vitest.config.storage-integration.ts`，普通pnpm check不自动连接外部服务；CI新增独立asset-storage-integration job。远程CI未执行，实际前端预览/设备及生产恢复仍需单独验收。

三仓冻结安装/check/build通过：Backend130文件1039项（初轮BCrypt5秒超时，降低并行负载后原规则复验通过），Web1459项且官网/Admin两个构建命中缓存，App56文件998项/Doctor20/20及三平台导出通过，产物`D:/linji-minio-storage-mobile/export-20261102`。本轮新增真实存储十项和原扫描五项通过；23迁移/双seed/前后db:verify通过，模拟对象与资产/会话/日志清理后只保留初始seed账号。一次附加核对误用不存在的ActorAccount字段导致Prisma拒绝，按实际schema修正后零日志断言通过；失败日志保留。未重跑完整历史DB/HTTP/Kafka套件，不新增产品契约或migration。

本轮资源已清理：Compose项目linji-minio-storage-20261102的MinIO容器/新卷/网络；按完整ID与linji.validation标签核对的PG容器e1249ca30f9eccbcd54b8b3c760c1fae8a3fcbb08252e666fb6d40a8bf581b1b及数据卷、扫描器cd9058c12342229e2194e4bdf1c6d37b38670fa8914f3f68251f5d2299eb076b；临时凭证文件。63001–63004无监听，原五个无关容器保留。本地构建镜像和原始日志保留供复核，无提交/推送/部署。
