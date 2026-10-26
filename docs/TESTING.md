# 测试与视觉验收

本文记录如何复现 Nocturne Chess 的自动测试、浏览器/Electron 启动、真实截图和交互检查。

## 1. 类型与单元/集成测试

```bash
pnpm typecheck
pnpm test
```

`pnpm test` 在 `apps/server` 运行 Vitest：

| 测试文件 | 覆盖 |
| --- | --- |
| `test/chess-game.test.ts` | 初始棋子 ID、合法走法、吃子、悔棋、吃过路兵、易位、升变、将军/将杀、认输 |
| `test/ai.test.ts` | AI registry、难度、取消、每档返回合法着法 |
| `test/integration.test.ts` | 真实 HTTP + WebSocket、token 拒绝、AI 自动回合、错误处理、悔棋/认输、静态服务 |

当前基线：**32 / 32 通过**。

## 2. Web 构建与启动

### 浏览器模式

```bash
pnpm web:build
CHESS_NO_OPEN=1 node scripts/serve-web.mjs
# 打开 http://127.0.0.1:8787/
```

浏览器模式将同一个 Node 后端作为静态服务器：同一端口提供页面、`/api/*` 与 `/ws`。无需 Electron、登录或 HTTPS。

验证 Web 服务：

```bash
curl -fsS http://127.0.0.1:8787/api/health
curl -fsS http://127.0.0.1:8787/api/runtime
curl -fsS http://127.0.0.1:8787/ | grep -q "Nocturne Chess"
```

浏览器开发模式：

```bash
pnpm web:dev
# 浏览器打开 http://127.0.0.1:5173/
```

Vite 将 `/api` 与 `/ws` 代理到本地后端；不会启动 Electron。

本次已完成的浏览器级验证：

- Brave/Chromium headless 加载 `http://127.0.0.1:8787/` 并完成 1440×960 实拍截图；
- Firefox headless 能加载页面与界面结构；
- 使用 Node 24 全局 `WebSocket`（浏览器同源 API）连接服务端，收到 `welcome` 与 32 枚棋子状态，并成功执行 `e2 → e4`；
- `/api/runtime`、favicon、JS/CSS 资源、CSP 与缓存头均响应正常。

### Electron 桌面模式（可选）

```bash
pnpm build
pnpm start
```

`pnpm start` 会以生产模式运行 Electron：主进程启动一个临时端口的本地后端，加载 `apps/web/dist` 的静态资源。

验证 Electron 开发模式（后端 :8787 + Vite :5173 + Electron）：

```bash
pnpm dev
```

Vite 将 `/api` 与 `/ws` 代理到后端，Electron 只提供窗口。关闭 Electron 窗口后 `concurrently` 会停止另外两个进程。

## 3. Electron 无头/真实窗口截图

```bash
pnpm screenshot
# 输出：artifacts/nocturne-chess.png
```

- 有桌面会话时使用硬件 WebGL。
- 没有 `DISPLAY` 时脚本自动使用 `Xvfb` + SwiftShader 软件 WebGL，并自动提高等待时间。
- 可强制软件渲染：`CHESS_SOFTWARE_GL=1 pnpm screenshot`。
- 可调整截图前的等待：`CHESS_CAPTURE_DELAY=20000 pnpm screenshot`。
- 截图由 Electron 自己的 `webContents.capturePage()` 完成，不是浏览器模拟。

## 4. Electron 交互自动化脚本

仅供开发/验收使用，正常游戏不启用。Electron 主进程支持以下环境变量：

| 变量 | 用途 |
| --- | --- |
| `CHESS_CAPTURE_PATH` | 截图输出路径；设置后会进入冒烟模式并自动退出 |
| `CHESS_CAPTURE_DELAY` | 首次等待毫秒数（默认 5000；无头脚本建议 18000） |
| `CHESS_CAPTURE_QUERY` | 追加到页面 URL，如 `?debug=1` |
| `CHESS_CAPTURE_SCRIPT` | 在截图前执行的 JS 文件路径（可使用异步 IIFE） |

`?debug=1` 会在 `window` 上暴露 store 和坐标投影辅助函数，仅用于本地验收。

`scripts/automation/` 内含：

| 脚本 | 验证内容 |
| --- | --- |
| `real-click.js` | 通过真实 Canvas 指针事件点击 e2、e4，验证 R3F 拾取和落子 |
| `select-opening.js` | 选中 e2 并显示合法落点 |
| `ai-white.js` | 切换到人机模式、人类执黑，等待 AI 执白自动落子 |
| `ai-panel.js` | 人机模式 + 窄窗抽屉面板 |
| `promotion-dialog.js` | 合法推进并触发升变选择弹窗 |
| `fools-mate.js` | 四步愚人将杀，验证终局弹窗与结果 |
| `fps.js` | 3 秒 `requestAnimationFrame` 采样，输出平均/中位/p95 帧时间与 FPS |

示例：

```bash
env -u DISPLAY -u WAYLAND_DISPLAY \
  CHESS_CAPTURE_PATH="$PWD/artifacts/pointer.png" \
  CHESS_CAPTURE_QUERY='?debug=1' \
  CHESS_CAPTURE_SCRIPT="$PWD/scripts/automation/real-click.js" \
  CHESS_CAPTURE_DELAY=16000 \
  pnpm exec electron --ozone-platform=x11 \
    --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader \
    --ignore-gpu-blocklist --disable-gpu-sandbox .
```

> 合成 `PointerEvent` 没有活跃的 pointer capture，R3F 可能打印 `releasePointerCapture` 警告；真实用户鼠标不会触发该警告，落子验证不受影响。

## 5. 手工检查清单（浏览器同样适用）

- [ ] 点击己方棋子：金色高亮、合法点、选中说明。
- [ ] 点击目标格：棋子弧线移动、最后一步标记、合成音效。
- [ ] 被吃棋子：消失并出现短暂金色闪光。
- [ ] 操作 `F`：棋盘旋转 180°，玩家卡顺序与近/远侧一致。
- [ ] 切换「人机对弈」：AI 设置出现，步数/难度切换会立即开新局。
- [ ] 人类执黑：AI 执白自动落子；思考状态可见。
- [ ] `U` / 悔棋：AI 模式回到人类回合，双人模式撤回一手。
- [ ] 认输：二次确认后弹出终局结果。
- [ ] 升变：四个选项、键盘 Q/R/B/N、取消返回棋盘。
- [ ] 将杀：终局弹窗、回合/吃子/最后一步统计。
- [ ] 窗口宽度 ≤1120：侧栏变为抽屉，遮罩、关闭按钮正常。
- [ ] 禁用 WebGL：自动切换到可操作的 2D 棋盘。

## 6. 安装包检查

```bash
pnpm dist:dir   # 已验证可启动
pnpm dist       # 生成平台安装包
```

本次实际生成了 `release/nocturne-chess-1.0.0-linux-x86_64.AppImage`（约 121 MB）并成功启动、加载 3D 场景。Windows NSIS 与 macOS DMG 已由 GitHub Actions 原生 runner 成功构建；本地只验证了 Linux 产物的运行时。

已验证 Linux `release/linux-unpacked/nocturne-chess` 能启动、提供本地后端，并加载 packaged asar 内的主进程与 resources/web 静态前端。

## 7. Docker 容器验收

```bash
docker build -t nocturne-chess-web:local .
docker run --rm -d --name nocturne-chess-web \
  -p 127.0.0.1:8787:8787 nocturne-chess-web:local

curl -fsS http://127.0.0.1:8787/api/health
curl -fsS http://127.0.0.1:8787/api/runtime
curl -fsS http://127.0.0.1:8787/ | grep -q "Nocturne Chess"
docker exec nocturne-chess-web id
docker inspect --format '{{.State.Health.Status}}' nocturne-chess-web
docker stop nocturne-chess-web
```

已验证：

- 镜像构建成功，运行阶段为 `uid=1000(node)` 非 root 用户；
- 健康检查最终为 `healthy`；
- 页面、API、favicon、`/api/runtime` 正常；
- Brave 1440×960 对容器服务完成真实 3D 渲染；
- 浏览器原生 WebSocket 完成 `e2 → e4`；
- `docker stop` 触发 SIGTERM，Node 服务优雅退出；
- `docker compose up --build` 可启动，默认宿主机端口绑定到 `127.0.0.1`。

构建结构、变量和安全边界见 [DOCKER.md](DOCKER.md)。

## 8. GitHub Actions

- `.github/workflows/ci.yml`：`main` push / PR 上运行 `typecheck`、`test`、`build`，启动浏览器版后端做 HTTP/静态资源 smoke 测试，并独立构建、运行 Docker 镜像做容器 smoke。
- `.github/workflows/release.yml`：`v*` tag 触发三平台原生构建，全部成功后自动生成 GitHub Release。
- 手动运行 Release 工作流只会产出 7 天有效的 workflow artifacts；不会创建 Release。
- tag 名（去掉 `v`）必须等于 `package.json.version`。
- 首轮三平台构建冒烟已通过；正式 Release 仍未在本轮自动创建，需推送 `v*` tag 或从 tag ref 手动运行。
- 构建矩阵会分别执行以下平台命令：

| 平台 | 命令 | 产物 |
| --- | --- | --- |
| Linux x64 | `pnpm package:linux` | AppImage |
| Windows x64 | `pnpm package:windows` | NSIS `.exe` |
| macOS x64 + arm64 | `pnpm package:macos` | 两个 DMG |

完整的发布、权限和签名说明见 [RELEASING.md](RELEASING.md)。
