# 跨平台构建与发布

Nocturne Chess 使用 GitHub Actions 在原生 runner 上构建三个桌面平台，并在推送 `v*` tag 时自动创建 GitHub Release。

## 1. 工作流

| 文件 | 触发 | 内容 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push 到 `main`、Pull Request、手动 | Linux 上安装、类型检查、32 项测试、生产构建 |
| `.github/workflows/release.yml` | push `v*` tag、手动 | Linux/Windows/macOS 原生构建；tag 触发时自动发布 |

Release 的构建矩阵：

| Runner | 产物 | 架构 |
| --- | --- | --- |
| `ubuntu-latest` | AppImage | x64 |
| `windows-latest` | NSIS 安装器 `.exe` | x64 |
| `macos-latest` | 两个 `.dmg` | Intel x64 + Apple Silicon arm64 |

每个构建任务都会先执行 `pnpm typecheck && pnpm test && pnpm build`，因此 Windows/macOS 的路径、脚本和测试也在原生环境中执行，而不是只靠 Linux 交叉打包。

## 2. 发布一个新版本

1. 修改根目录 `package.json` 的 `version`，例如 `1.0.1`。
2. 提交并推送代码到 `main`：

   ```bash
   git add .
   git commit -m "release: v1.0.1"
   git push origin main
   ```

3. 创建并推送匹配的 tag（tag 去掉前缀 `v` 后必须与 `package.json` 完全一致）：

   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```

4. Actions 会并行构建三个平台。三个构建都成功后，Release job 才会下载全部产物、生成 `SHA256SUMS.txt`，并发布到：

   ```text
   https://github.com/tianmingbuaa/electron-3d-chess/releases/tag/v1.0.1
   ```

如果 tag 是 `v1.0.1-beta.1`（含 `-`），GitHub Release 会被标记为 prerelease。

## 3. 手动构建（不发布）

> 本轮已在临时分支上完成过一次三平台构建冒烟：Linux AppImage、Windows NSIS、macOS x64/arm64 DMG 均成功，Release job 因非 tag 被跳过。临时分支已删除。

在 GitHub → Actions → **Release** → **Run workflow** 中从 `main` 触发。

工作流会完成三平台构建并保留 workflow artifacts（7 天），但 release job 的条件是 `refs/tags/v*`，因此手动在分支上运行时**不会创建 Release**。

要复现某一平台：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build

# 仅在对应平台执行
pnpm package:linux    # Linux x64
pnpm package:windows  # Windows x64
pnpm package:macos    # macOS x64 + arm64
```

`electron-builder` 的 DMG/NSIS 目标依赖原生平台工具，不建议跨平台强行打包。

## 4. 产物命名

`package.json` 使用统一的 artifact 模板：

```json
"artifactName": "nocturne-chess-${version}-${os}-${arch}.${ext}"
```

示例（`${os}` 在 electron-builder 中分别为 `linux` / `win` / `mac`；Linux 的 `${arch}` 当前展开为 `x86_64`）：

```text
nocturne-chess-1.0.0-linux-x86_64.AppImage
nocturne-chess-1.0.0-win-x64.exe
nocturne-chess-1.0.0-mac-x64.dmg
nocturne-chess-1.0.0-mac-arm64.dmg
SHA256SUMS.txt
```

macOS 发布两个单架构 DMG 而不是 universal DMG，避免合并签名和原生 runner 架构差异带来的额外不确定性；两个文件都可用，用户按自己的 CPU 选择。

## 5. 权限要求

仓库需要允许 Actions 写 Release。检查：

**Settings → Actions → General → Workflow permissions**  
选择 **Read and write permissions**，或者至少确保工作流级 `permissions: contents: write` 没有被组织策略禁止。

工作流已经声明：

```yaml
permissions:
  contents: read        # 默认
jobs:
  release:
    permissions:
      contents: write   # 仅发布任务
```

## 6. 未签名构建说明

当前 CI **不进行代码签名，也不做 Apple notarization**。这是为了在没有证书 secret 的仓库中也能产出可用安装包，但会有平台安全提示：

- **macOS**：首次打开可能出现“无法验证开发者”。可右键 → 打开；如果被 quarantine 阻止，可执行：

  ```bash
  xattr -dr com.apple.quarantine "/Applications/Nocturne Chess.app"
  ```

- **Windows**：SmartScreen 可能提示未知发布者。选择“更多信息 → 仍要运行”。NSIS 是非管理员、可选安装目录模式。

生产分发建议后续增加：

- Apple Developer ID Application 证书 + `notarize`（Apple ID / Team ID / 专用密码）；
- Windows Authenticode 证书（`CSC_LINK` / `CSC_KEY_PASSWORD`）；
- 移除 `CSC_IDENTITY_AUTO_DISCOVERY: false` 并按 electron-builder 文档配置签名。

签名与密钥必须放在 GitHub Actions Secrets 中，不能提交到仓库。

## 7. 本地配置测试

```bash
# 验证工作流 YAML 与脚本本身
bash -n scripts/capture.sh

# 在任何平台先跑完整逻辑
pnpm typecheck && pnpm test && pnpm build

# Linux 产物冒烟
CHESS_CAPTURE_PATH="$PWD/artifacts/packaged.png" \
CHESS_CAPTURE_DELAY=7000 \
timeout 40s ./release/nocturne-chess-1.0.0-linux-x86_64.AppImage
```

## 8. 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| Release job 403 | 仓库 Workflow permissions 为只读，或组织策略禁止写 Release |
| Mac app 被 Gatekeeper 拦截 | 构建未签名；见第 6 节 |
| Windows SmartScreen 警告 | 构建未签名；见第 6 节 |
| tag 版本校验失败 | tag（去掉 `v`）必须等于 `package.json.version` |
| macOS 只看到一个架构的 DMG | 检查流程中的 `package:macos` / builder 参数是否包含 `--x64 --arm64` |
| AppImage 无法运行 | 确保 FUSE 可用，或使用 `--appimage-extract-and-run` |
