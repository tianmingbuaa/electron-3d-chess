# 开发路线

本文记录 Nocturne Chess 的开发阶段、任务拆分、交付标准和后续增强方向。

## 阶段总览

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 0 | 架构、协议、monorepo 骨架 | 完成 |
| 1 | 后端子 agent：棋规、会话、WebSocket、AI SPI、测试、协议/AI 文档 | 完成（32 项测试） |
| 2 | 视觉子 agent：六类程序化 3D 棋子 | 完成（182,968 三角形/32 子） |
| 3 | 主 agent：Electron 壳、React 3D 场景、交互、视觉系统 | 完成 |
| 4 | 联调、实际 Electron 渲染截图、性能与交互修正 | 完成 |
| 5 | 打包验证、最终文档与全链路回归 | 完成 |
| 6 | GitHub Actions 三平台 CI 与 Release 发布 | 完成（首轮 CI + 三平台构建冒烟通过） |
| 7 | 浏览器本地 Web 模式：启动器、文档、真实浏览器验收 | 完成 |
| 8 | Docker 容器化：多阶段镜像、自包含后端、Compose、CI 冒烟 | 完成 |

## 阶段 0：架构与契约

- [x] 选择浏览器优先的 React + React Three Fiber 3D 技术路线，并保留 Electron 桌面壳
- [x] 前后端分离；开发/生产两套拓扑
- [x] pnpm workspace：`shared` / `server` / `web` / `desktop`
- [x] 定义共享领域模型、完整 WebSocket 消息协议、AI Provider SPI
- [x] 定义棋局快照语义：稳定棋子 ID、完整 legalMoves、lastMove、revision
- [x] 规划测试与打包策略

## 阶段 1：后端（子 agent）

- [x] 独立后端进程 / 可嵌入 `createChessServer`
- [x] chess.js 权威规则封装、升变/易位/吃过路兵、稳定 ID、快照栈
- [x] 终局判定：将杀、逼和、三次重复、子力不足、五十回合
- [x] 每连接 GameSession、入站校验、错误码
- [x] 双人悔棋；人机悔棋回到人类回合
- [x] AI 调度：thinking 状态、取消/超时、AI 合法落子复核
- [x] `/api/health`、`/api/runtime`、token 校验、SPA 静态服务
- [x] `AiProviderRegistry` + Simple Atelier Engine（1/2/3 层）
- [x] Vitest：规则、AI、WebSocket 集成（**32/32 通过**）
- [x] `docs/PROTOCOL.md`、`docs/AI_EXTENSION.md`

**验收**：`typecheck`、`test`、`build` 全部通过；不依赖 Electron 即可独立启动。

## 阶段 2：程序化棋子（子 agent）

- [x] 六种棋子各有辨识度，比例统一、无网络模型/贴图
- [x] 象牙/黑曜石 PBR 材质 + 黄铜细节
- [x] 几何/材质复用，32 枚棋子合计 182,968 三角形（单枚 ≤ 7,488）
- [x] 白方骑士面向 -Z，黑方面向 +Z
- [x] 根节点底面于 y=0，占地 ≤ 0.68 方格

**验收**：实际 Electron 3/4 视角截图下轮廓清晰、无明显穿插或缺失。

## 阶段 3：桌面与渲染（主 agent）

- [x] Electron 主进程：窗口、安全、生命周期、生产内嵌后端
- [x] 开发模式：Vite 代理 + 独立后端
- [x] `createChessServer` 启动、随机端口、退出优雅关闭
- [x] preload 最小暴露面；IPC 只提供桌面信息
- [x] 像素比限制、软阴影、PBR、程序化环境反射
- [x] 棋盘：基座、圆角格、黄铜嵌线、坐标、铭牌、脚垫
- [x] 选子/合法点/最后一步/将军标记
- [x] 棋子弧线移动、选中缩放、被吃闪光
- [x] 棋盘 180° 平滑翻转
- [x] UI：顶栏、对局面板、棋谱、吃子、设置、终局/升变/认输弹窗
- [x] WebAudio 合成音效
- [x] 键盘快捷键与基础无障碍标签
- [x] 响应式布局（面板抽屉）
- [x] 2D 降级棋盘
- [x] 实际渲染截图并调色/调机位（1440 × 960）
- [x] 真实交互回归（点击、AI 自动落子、翻转、终局、抽屉面板）

## 阶段 4：联调与质量

- [x] 启动独立后端 + Vite + Electron 开发链路（HTTP/WS 代理验证）
- [x] 双人完整对局（愚人将杀、吃子、回合切换）
- [x] 人机对弈：AI 自动落子、think 状态、难度切换、执黑视角
- [x] 悔棋、认输、新局在两种模式下行为正确（后端集成测试）
- [x] 升变参数与弹窗路径（真实棋步触发四选弹窗 + 后端升变测试）
- [x] Electron 生产构建与截图
- [x] 3D 帧率/GPU 负载检查（3 秒采样 60.2 FPS，p95 16.8ms）
- [x] 窗口缩放、宽窄屏、面板打开状态
- [x] WS 断线重连提示
- [x] 真实 Canvas pointer 事件点击 e2 → e4

## 阶段 5：发布

- [x] `pnpm build`、`pnpm dist`、`pnpm dist:dir` 产物验证并实际启动
- [x] 应用图标、产品名、安装包配置
- [x] README / 架构 / 协议 / AI 文档互链
- [x] 两位模块子 agent 自测 + 主 agent 全链路回归与文档核对
- [x] 清理调试日志与临时文件
- [x] AppImage 实际生成并启动（`release/nocturne-chess-1.0.0-linux-x86_64.AppImage`，121 MB）

## 阶段 6：跨平台 CI / Release

- [x] macOS 跨平台修正：恢复原生应用菜单（Cmd+Q / Cmd+W / 编辑快捷键）
- [x] Windows 跨平台修正：AppUserModelID、多尺寸 `icon.ico`、非管理员 NSIS 安装
- [x] 统一 8-bit 跨平台图标，Linux/macOS 使用 PNG 源，Windows 使用 ICO
- [x] 统一 artifact 命名：`nocturne-chess-${version}-${os}-${arch}.${ext}`
- [x] `.gitattributes` 强制脚本/workflow 使用 LF，避免 Windows checkout 破坏 shell
- [x] CI 工作流：main/PR 上 typecheck、32 项测试、生产构建
- [x] Release 工作流：Ubuntu/Windows/macOS 原生 runner 并行构建
- [x] macOS 同时构建 x64/arm64 DMG；Windows 构建 x64 NSIS；Linux 构建 x64 AppImage
- [x] tag 版本与 `package.json.version` 一致性校验
- [x] 三平台产物汇总后生成 `SHA256SUMS.txt` 并自动发布 GitHub Release
- [x] 发布指北：签名/公证、权限、手动构建和未签名提示
- [x] 首轮 GitHub Actions CI 通过；Windows/macOS/Linux 原生构建冒烟通过；临时验证分支已删除

## 阶段 7：浏览器本地 Web 模式

- [x] 新增 `pnpm web`：构建 Web 前后端并在 `127.0.0.1:8787` 启动，尝试自动打开默认浏览器
- [x] 新增 `pnpm web:serve` / `pnpm web:build` / `pnpm web:dev` 三条独立命令
- [x] 浏览器启动器 `scripts/serve-web.mjs`：静态页面 + API + WebSocket 同源单端口
- [x] 固定回环监听、普通 HTTP、无账号/登录/多人房间依赖
- [x] 浏览器构建目标从 Electron 专用版本调整为 ES2022
- [x] 修复 macOS 浏览器误套用 Electron 交通灯留白的问题
- [x] 增加 favicon / Apple touch icon
- [x] 新增 `docs/WEB.md`，并更新 README/架构/测试文档
- [x] CI 增加浏览器 Web 服务 smoke 测试
- [x] Brave/Chromium 1440×960 真实渲染、Firefox 页面加载、浏览器原生 WebSocket 对局验证

## 阶段 8：Docker 容器化

- [x] 多阶段 Dockerfile：Node 24 slim builder + 精简 runtime
- [x] 只构建 Web/Server，运行镜像不含 Electron、pnpm、业务源码或 node_modules
- [x] `tsup.container.config.ts` 打包自包含 server bundle（ws/chess.js/shared）
- [x] `serve-web.mjs` 支持容器 `CHESS_HOST=0.0.0.0` 与构建产物路径环境变量
- [x] 非 root `node` 用户、`EXPOSE 8787`、Node fetch `/api/health` 健康检查
- [x] `.dockerignore` 缩小上下文，`compose.yaml` 默认仅发布到宿主机 loopback
- [x] CI 独立 Docker job：镜像构建 + 容器运行 + HTTP smoke
- [x] 实际构建镜像、运行、浏览器渲染、WebSocket 对局、Compose、SIGTERM 优雅停止
- [x] Docker 文档与 README/架构/测试/路线互链

## 实际验收记录

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 4 个 workspace 包全部通过 |
| `pnpm test` | 32/32，通过（约 1.1s） |
| `pnpm build` / `pnpm dist:linux` / `pnpm dist:dir` | 通过；新命名 AppImage 与 `release/linux-unpacked` 均可启动 |
| `pnpm web:build` + 本地 Web 服务 | 通过；页面、favicon、`/api/runtime`、`/api/health` 正常 |
| Brave/Chromium 浏览器 | headless 1440×960 完整 3D 渲染，页面在线 |
| Firefox 浏览器 | 页面与界面结构正常加载（无头截图） |
| 浏览器原生 WebSocket | 收到 32 枚棋子的 welcome，完成 `e2 → e4` |
| 开发模式代理 | `GET :5173/api/runtime` 与 `ws://:5173/ws` 正常 |
| 真实指针点击 | 点击 e2 选中，点击 e4 落子成功 |
| AI 执白 | 点击“执黑”后自动落子 `Na3`，棋盘翻转 |
| 终局 | 愚人将杀 → “黑方胜 / Checkmate”弹窗 |
| 3D 降级 | 无 WebGL 时自动切换 2D 棋盘，可继续对弈 |
| 截图 | 1440×960 浏览器实机窗口，见 `docs/images/nocturne-chess-browser.png` |
| 渲染帧率 | 1024×653 / DPR 1：60.2 FPS，p95 16.8ms |
| Docker 镜像 | `docker build` 成功，运行用户 `uid=1000(node)`，健康检查 `healthy` |
| Docker 完整链路 | 页面/API/favicon 正常；Brave 1440×960 渲染；WebSocket `e2→e4` 成功 |
| Docker Compose | `docker compose up --build` 通过，端口仅绑定 `127.0.0.1` |
| CI | 浏览器 Web smoke + 独立 Docker job 已加入 `.github/workflows/ci.yml` |
| GitHub Actions CI | 通过（[run 40204195388](https://github.com/tianmingbuaa/electron-3d-chess/actions/runs/40204195388)） |
| 三平台构建 | Windows x64 / macOS x64+arm64 / Linux x64 全部成功；Release job 按预期在非 tag 运行中跳过（[run 40204315643](https://github.com/tianmingbuaa/electron-3d-chess/actions/runs/40204315643)） |

## 后续增强（非本期范围）

1. **更强 AI**：UCI Stockfish 子进程 / 远程 LLM 服务 / 开局库。
2. **棋局持久化与回放**：SQLite、PGN 导入导出、逐步回放。
3. **计时与赛制**：快棋、加秒、超时判负。
4. **在线对战**：房间、观众、重连恢复、反作弊。
5. **分析模式**：引擎评估条、最佳着提示、失误检测。
6. **主题工坊**：可替换材质包/棋子套装/环境光照。
7. **签名与自动更新**：Apple notarization、Windows Authenticode、更新服务器/签名校验。
8. **国际化**：多语言 UI 与文档。
9. **容器镜像发布**：登录 GHCR/Registry，按版本推送镜像并补充 SBOM/签名。

## 协作拆分子 agent 的理由

本期将两个高内聚、低耦合的模块并行交给子 agent：

- **后端**：规则、协议实现、AI SPI、测试与协议文档。产物可完全脱离前端验证。
- **3D 棋子**：仅一个 TSX 文件，输入是 `(type, color)`，输出是静态可交互网格；边界清晰，便于主 agent 同时负责场景与 UI。

主 agent 负责共享契约、Electron、前端场景/UI、最终联调与全链路回归。模块 owner 自测与主 agent 的独立运行测试相互补充，降低“实现者自己验收自己”的盲区。
