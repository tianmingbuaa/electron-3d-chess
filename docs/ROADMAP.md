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

## 阶段 0：架构与契约

- [x] 选择 Electron + Vite + React + React Three Fiber 3D 技术路线
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
- [x] AppImage 实际生成并启动（`release/Nocturne Chess-1.0.0.AppImage`，121 MB）

## 实际验收记录

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 4 个 workspace 包全部通过 |
| `pnpm test` | 32/32，通过（约 1.1s） |
| `pnpm build` / `pnpm dist` / `pnpm dist:dir` | 通过；AppImage 与 `release/linux-unpacked` 均可启动 |
| 开发模式代理 | `GET :5173/api/runtime` 与 `ws://:5173/ws` 正常 |
| 真实指针点击 | 点击 e2 选中，点击 e4 落子成功 |
| AI 执白 | 点击“执黑”后自动落子 `Na3`，棋盘翻转 |
| 终局 | 愚人将杀 → “黑方胜 / Checkmate”弹窗 |
| 3D 降级 | 无 WebGL 时自动切换 2D 棋盘，可继续对弈 |
| 截图 | 1440×960 实机窗口，见 `docs/images/nocturne-chess.png` |
| 渲染帧率 | 1024×653 / DPR 1：60.2 FPS，p95 16.8ms |

## 后续增强（非本期范围）

1. **更强 AI**：UCI Stockfish 子进程 / 远程 LLM 服务 / 开局库。
2. **棋局持久化与回放**：SQLite、PGN 导入导出、逐步回放。
3. **计时与赛制**：快棋、加秒、超时判负。
4. **在线对战**：房间、观众、重连恢复、反作弊。
5. **分析模式**：引擎评估条、最佳着提示、失误检测。
6. **主题工坊**：可替换材质包/棋子套装/环境光照。
7. **国际化与平台打包**：macOS/Windows/Linux 签名与自动更新。

## 协作拆分子 agent 的理由

本期将两个高内聚、低耦合的模块并行交给子 agent：

- **后端**：规则、协议实现、AI SPI、测试与协议文档。产物可完全脱离前端验证。
- **3D 棋子**：仅一个 TSX 文件，输入是 `(type, color)`，输出是静态可交互网格；边界清晰，便于主 agent 同时负责场景与 UI。

主 agent 负责共享契约、Electron、前端场景/UI、最终联调与全链路回归。模块 owner 自测与主 agent 的独立运行测试相互补充，降低“实现者自己验收自己”的盲区。
