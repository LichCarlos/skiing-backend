# 公开仓库、SDK 与凭证管理

## 提交范围

提交源码、测试、文档、必要静态资源、迁移、OpenAPI 快照、package.json、pnpm-lock.yaml 和脱敏的 .env.example。依赖清单中出现 Expo SDK、AWS SDK 等包名是正常的，安装后的 SDK/依赖二进制不会提交。

以下保留在仓库外或被 .gitignore 排除：Android SDK/NDK/JDK、工具安装目录、node_modules、pnpm store、Next/Expo/原生构建目录、安装包、模型权重、虚拟磁盘、数据库备份、上传存储、日志、真实 .env、JWT/模型/存储凭证、Android keystore 与 iOS 签名文件。本地 D 盘发布记录、运行配置和验证副本也不是 GitHub 源码仓库。

Backend 仅显式保留 test/fixtures/kafka-tls 的三个公开 TEST ONLY PEM 文件，用于离线 TLS 测试；该证书和私钥绝不能用于任何业务服务。说明见该目录 README。其他凭证文件仍被拒绝。

## 每次推送前

```bash
git status --short
git diff --stat
git add <明确的源码或文档路径>
git diff --cached --stat
node scripts/check-repository.mjs
gitleaks git . --redact --log-opts="--all"
git commit -m "说明实际变更"
git push origin main
```

`check-repository.mjs` 检查 Git 索引中的 SDK、私有配置、生成产物、签名文件、符号链接和异常大文件。Gitleaks 另行扫描内容和提交历史；两者互补。先 stage 再运行索引检查，敏感文件误入暂存时用 `git restore --staged -- <路径>` 撤出，不删除本地配置。首次无提交的仓库在 commit 后运行历史扫描。

Windows 可使用 Git Credential Manager 完成 HTTPS 授权。不要把 PAT 放入 remote URL、脚本、README 或命令历史。origin 指向本项目仓库；Web 模板历史的 upstream 只供来源追溯，不向它推送业务代码。

## 自动检查

`.github/workflows/security.yml` 在 push/PR 执行边界检查和完整历史 Gitleaks 扫描；功能检查仍在原 CI 工作流。配置中的例外仅对应公开校验摘要、确定的业务标识与测试夹具，不能用整个测试目录或文档目录作通配白名单。

本地安装 Gitleaks 可使用其[官方发布页](https://github.com/gitleaks/gitleaks/releases)，下载对应系统版本并对照官方 checksums。不要将工具本体放入仓库。CI 失败应修复内容或确认精确误报后添加最小例外，不应禁用扫描来通过发布。

## 环境与部署权限

- NEXT_PUBLIC_* / EXPO_PUBLIC_* 会进入浏览器/移动包，仅允许公开地址和公开标识。
- 数据库、JWT、Embedding/Chat Key、存储密码只在后端私有环境中管理，服务器配置放在仓库和 release 包之外。
- GitHub Actions 中如需真正部署，使用受保护 Environment 和 Secrets；当前工作流只检查/构建，不自动更新线上服务或提交商店。
- 不提交默认管理员的真实账号密码。初次 seed 使用本地设置的值，之后通过管理流程维护。
- 使用与再分发以各仓实际 LICENSE 和第三方声明为准，本次未变更授权；App 保留 Expo 模板原有 MIT 许可证与版权声明。没有明确授权的部分应先取得所有者许可。

## 发现误提交时

先撤销/轮换泄露凭证。删除工作树文件或添加 .gitignore 不会删除 Git 历史中的秘密；按 GitHub 的[敏感数据清理流程](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)协调历史清理和协作者副本。不要擅自 force push，也不要在 Issue/截图/日志中重复贴出密钥。
