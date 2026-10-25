# Nocturne Chess 本地协议参考

本文档描述 `@nocturne/chess-server` 对 Electron renderer / 浏览器暴露的 HTTP 与 WebSocket 协议。协议定义以 `packages/shared/src/index.ts`（`@nocturne/chess-shared`）为唯一事实来源；本服务端只是其权威实现。

- 协议版本：`PROTOCOL_VERSION = 1`
- 服务端名称：`Nocturne Chess Server`
- 默认绑定：`127.0.0.1`，端口 `0`（临时端口；CLI 默认 `8787`）
- WebSocket 路径：`/ws`
- 所有 JSON 都是 UTF-8；WebSocket 只接受文本帧。

```
Electron main / renderer ── HTTP 发现 + token ──┐
        │                                      ▼
        └──────── WebSocket /ws?token=... ──> chess-server（权威状态）
                                                   │
                                      ChessGame / GameSession
                                                   │
                                            AiProviderRegistry
```

## 1. 安全模型与认证

### 1.1 仅本地回环

服务端默认只监听 `127.0.0.1`。HTTP API 与 WebSocket 共用同一个随机 token：

1. 启动时如果没有提供 token，服务端用 `crypto.randomBytes` 生成；
2. renderer 通过 `GET /api/runtime` 读取 `token` 与 `wsPath`；
3. renderer 用 `ws://127.0.0.1:<port>/ws?token=<token>` 建立连接。

`/api/health` 与 `/api/runtime` 本身不要求鉴权，因为服务端按设计只在本机回环地址可用。`runtime` 会返回 token，因此**不要把服务端绑定到 `0.0.0.0` 或对外网开放的接口**，除非你已经在外层增加鉴权与 TLS 终止。

### 1.2 WebSocket 握手拒绝

缺 token、token 错误、路径不是 `/ws` 时，服务端在 HTTP Upgrade 阶段拒绝：

- 401 Unauthorized（token 缺失/错误）
- 404 Not Found（路径错误）

浏览器/`ws` 客户端会看到“Unexpected server response: 401”之类的握手错误，而不是普通的 WebSocket `close` 帧。连接成功后，除 `welcome` 外不使用 `unauthorized` 错误帧。

### 1.3 HTTP CORS

仅为**回环来源**（`http://localhost:*`、`http://127.0.0.1:*`、`http://[::1]:*`，以及 https 对应项）反射 `Access-Control-Allow-Origin`。其他来源不会获得 CORS 授权，网页无法读取 runtime token。生产环境的 Electron 通常使用同源静态资源，不需要 CORS。

### 1.4 安全响应头

所有 HTTP 响应都包含：

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Cross-Origin-Resource-Policy: same-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Content-Security-Policy`（包含 `frame-ancestors 'none'`、仅允许同源脚本/连接；为兼容资源加载允许 `data:`/`blob:` 图像与 worker）

## 2. HTTP API

### 2.1 端点

| Method | Path | 响应 | 缓存 |
| --- | --- | --- | --- |
| `GET` / `HEAD` | `/api/health` | `HealthInfo` JSON | `no-store` |
| `GET` / `HEAD` | `/api/runtime` | `RuntimeInfo` JSON | `no-store` |
| `OPTIONS` | `/api/*` | `204 No Content`，带 `Allow` 与回环 CORS 头 | — |
| `GET` / `HEAD` | `/ws` | `426 Upgrade Required` JSON（必须走 Upgrade） | `no-store` |
| `GET` / `HEAD` | 其他路径 | 若配置了 `staticDir`，返回静态文件/SPA fallback；否则 404 | 见静态资源 |
| 其他 method | `/api/*`、静态路径 | `405 Method Not Allowed` JSON | `no-store` |

未知 API 路径返回 `404` 且**不会**落到 SPA fallback。`/ws` 和 `/api/*` 优先于静态文件。

```http
GET /api/health HTTP/1.1
```

```json
{
  "ok": true,
  "serverName": "Nocturne Chess Server",
  "serverVersion": "1.0.0",
  "protocolVersion": 1,
  "uptimeSeconds": 12
}
```

```http
GET /api/runtime HTTP/1.1
```

```json
{
  "serverName": "Nocturne Chess Server",
  "serverVersion": "1.0.0",
  "protocolVersion": 1,
  "wsPath": "/ws",
  "token": "TSFka3sKnnyN04gHGGI2rRejnAFOHTz5"
}
```

### 2.2 JSON 错误格式

非成功 HTTP 响应（除静态文件流错误外）统一为：

```json
{
  "error": {
    "code": "bad_request",
    "message": "Unknown API endpoint."
  }
}
```

`code` 取值见第 7 节。静态路径的路径穿越/错误编码分别返回 `403/400`，不会泄漏文件内容。

### 2.3 静态 SPA 服务

设置 `staticDir` 后：

- `/`、无扩展名的前端路由（如 `/lobby/table/42`）回退到根目录 `index.html`；
- 有扩展名的缺失文件（如 `/assets/missing.js`）返回 404，**不会**回退成 HTML；
- `assets/` 目录下的文件及带内容哈希的文件使用 `Cache-Control: public, max-age=31536000, immutable`；
- `index.html` 等未哈希文件使用 `no-cache`；
- 正确设置常见 MIME 类型（`.js` → `text/javascript`、`.css`、`.wasm`、字体、图片等）；
- 拒绝 `..`、隐藏路径段、反斜杠、NUL、Windows 盘符等，并对解析后的真实路径做根目录包含检查（含 symlink 目标）；路径穿越返回 403。

## 3. WebSocket 生命周期

```
客户端                                  服务端
  │ ── HTTP Upgrade /ws?token=... ──────> │ 校验 token，失败 401
  │ <──────────── welcome ─────────────── │ 创建独立 GameSession（revision=0）
  │ ── new_game / move / undo / ... ────> │ 同步校验 + 修改 GameSession
  │ <──────────── state / error ───────── │ 每次变更发送完整 GameState
  │ ── ping ─────────────────────────────> │
  │ <──────────── pong ─────────────────── │
```

- 每个 WebSocket 连接拥有**独立** session 与独立棋盘；连接关闭即销毁，不做跨连接恢复。
- 建立连接后服务端立即发送第一条消息 `welcome`。
- 文本帧必须是单个 JSON 对象；二进制帧返回 `bad_request` 错误，连接保持。
- 单条消息上限 256 KiB；超限由 `ws` 关闭连接。
- 所有由客户端命令导致的错误都发送 `error` 消息，socket 保持打开。应用级异常不会导致进程崩溃。

## 4. 客户端 → 服务端消息

所有消息都是 JSON 对象，可选的 `requestId` 为最长 128 字符的字符串。服务端在对应的 `state`/`error`/`pong` 中回显 `requestId`；AI 自动落子产生的 `state` 没有 `requestId`。

| `type` | 必填字段 | 说明 |
| --- | --- | --- |
| `new_game` | `config: NewGameConfig` | 开始新对局并切换模式/配置 |
| `move` | `move: { from: Square, to: Square, promotion?: 'q'\|'r'\|'b'\|'n' }` | 走子；升变必须显式提供 `promotion` |
| `undo` | — | 悔棋，语义见第 5.5 节 |
| `restart` | — | 以当前配置重开一局 |
| `resign` | — | 认输，语义见第 5.4 节 |
| `ping` | — | 心跳，服务端返回 `pong` |

### 4.1 `NewGameConfig`

```ts
interface NewGameConfig {
  mode: 'local' | 'ai';
  humanColor?: 'w' | 'b';     // 仅 ai 模式有效，默认白方
  ai?: {
    providerId: string;       // 默认取服务端 defaultAiProviderId（通常 'simple'）
    difficulty: 'easy' | 'normal' | 'hard'; // 默认 normal
  };
}
```

校验规则：

- `mode` 必须是 `local`/`ai`；`humanColor`、难度、providerId 类型非法 → `bad_request`；
- `ai` 模式指定的 provider 必须已在 registry 注册，且 `capabilities.difficulties` 包含请求难度，否则 `bad_request`；
- 若省略 `ai`，使用 `defaultAiProviderId` 与 `normal`；
- `local` 模式的 `humanColor` 归一化为 `null`，`ai` 归一化为 `null`；
- 非法配置不会改变当前对局，也不会取消正在思考的 AI。

### 4.2 `move` 与升变

- `from`/`to` 必须是 `a1`–`h8` 的合法 square；非法 → `bad_request`；
- 兵到达底线时省略 `promotion` → `invalid_move`（不会默认升后）；
- 形状合法但棋规不允许 → `illegal_move`；
- AI 模式只允许 human 在 `humanColor` 的回合走子，否则 `not_your_turn`；
- AI 思考期间不允许人类走子，返回 `ai_busy`；
- 对局已结束时返回 `game_over`。

### 4.3 示例

```json
{
  "type": "new_game",
  "requestId": "req-1",
  "config": {
    "mode": "ai",
    "humanColor": "w",
    "ai": { "providerId": "simple", "difficulty": "normal" }
  }
}
```

```json
{
  "type": "move",
  "requestId": "req-2",
  "move": { "from": "e2", "to": "e4" }
}
```

```json
{ "type": "undo", "requestId": "req-3" }
```

```json
{ "type": "ping", "requestId": "req-4" }
```

## 5. 服务端 → 客户端消息

### 5.1 消息类型

| `type` | 字段 | 说明 |
| --- | --- | --- |
| `welcome` | `info: ServerInfo`, `state: GameState` | 连接后的第一条消息；默认本地模式，revision=0 |
| `state` | `state: GameState`, `requestId?`, `notice?` | 完整快照；`notice` 仅用于提示（例如 AI 失败） |
| `error` | `error: { code, message }`, `requestId?` | 命令错误；socket 保持打开 |
| `pong` | `requestId?` | 对 `ping` 的响应 |

`ServerInfo` 包含协议版本、服务端版本和当前 registry 中的 AI provider 元数据（`AiProviderInfo[]`）。

### 5.2 `GameState` 字段

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| `sessionId` | string | 本连接的唯一会话 ID（UUID） |
| `revision` | number | 快照版本；新连接从 0 开始，成功修改后单调递增 |
| `fen` | string | 当前局面 FEN |
| `mode` | `'local' \| 'ai'` | 当前模式 |
| `humanColor` | `'w' \| 'b' \| null` | AI 模式人类执色；本地模式为 `null` |
| `ai` | `AiStatus \| null` | AI 模式始终有值（包含结束后），本地模式为 `null` |
| `pieces` | `PieceState[]` | 32 个以内棋子，带稳定 ID、类型、颜色、当前 square |
| `turn` | `'w' \| 'b'` | 当前走子方 |
| `phase` | `'playing' \| 'finished'` | 结束后 `legalMoves` 为空 |
| `inCheck` | boolean | 当前走子方是否被将军 |
| `checkSquare` | `Square \| null` | 被将军一方的王所在 square |
| `result` | `GameResult \| null` | `{ winner: Color\|null, reason }` |
| `legalMoves` | `Partial<Record<Square, Square[]>>` | 当前走子方所有合法目标，按起点分组；升变目标去重 |
| `history` | `MoveRecord[]` | 从当前对局起点开始的完整着法历史 |
| `lastMove` | `LastMoveInfo \| null` | 最近一手的富信息，用于动画 |
| `canUndo` | boolean | 当前是否允许悔棋（客户端应以此为准，而非自行推断） |
| `moveNumber` | number | 当前局面的 full-move number（FEN 第 6 段） |

`AiStatus`：

```ts
{
  color: Color;              // AI 执色
  providerId: string;
  providerName: string;
  difficulty: AiDifficulty;
  thinking: boolean;         // 是否正在调用 provider
}
```

`LastMoveInfo` 继承 `MoveRecord`（`index`、`moveNumber`、`san`、`from`、`to`、`color`、`piece`、`captured?`、`promotion?`），并额外包含：

```ts
{
  pieceId: string;                     // 走子棋子的稳定 ID
  capturedPiece?: {
    id: string;
    type: PieceType;
    color: Color;
    square: Square;                    // 被吃棋子被移除时所在 square
  };
  castling?: {
    kingId: string;
    rookId: string;
    rookFrom: Square;
    rookTo: Square;
  };
}
```

- 普通吃子时 `capturedPiece.square === to`；
- 吃过路兵时 `capturedPiece.square` 是被吃兵所在 square（例如 `e5` 兵吃 `d6`，记录 `d5`）；
- 王车易位同时移动王与车，`castling` 给出双方 ID 和车的起止 square；王的信息在 `from/to/pieceId`。

### 5.3 稳定棋子 ID

- 格式：`<color>-<pieceType><ordinal>`，例如 `w-k1`、`w-p5`、`b-r2`；
- 在**一局游戏的整个生命周期**内稳定：走子、吃子、王车易位、升变（兵保持原 ID，`type` 变为 `q/r/b/n`）都不会改变 ID；
- 悔棋会从快照恢复被吃棋子的原 ID；
- `new_game` / `restart` 会重新分配（使用同样的确定性规则）；跨对局不承诺 ID 连续。
- 初始局面 ID 由棋盘扫描顺序确定；例如 `w-p1` 对应 `a2`，`w-p5` 对应 `e2`。

### 5.4 AI 模式、认输与结束

- `new_game` 后若当前轮到 AI（典型：人类执黑），服务端立即发送 `ai.thinking=true` 的 `state`，随后自动落子；
- AI 落子由后端校验并应用，人类客户端的任何 `move` 都不能代替 AI 走子；
- AI 思考期间：不允许 `move`（`ai_busy`），不允许 `undo`（`ai_busy`）；
- AI 失败/超时后：保持当前局面不变，`ai.thinking=false`，先发送带 `notice` 的 `state`，再发送 `internal_error`；此时轮到 AI，人类可 `undo` 一手回到自己的回合；
- **认输**：
  - `local` 模式：当前走子方认输，winner 为对手；
  - `ai` 模式：命令始终代表 `humanColor` 认输，winner 为 AI；即使 AI 正在思考也接受，并中止 AI 任务；
  - 已结束后再 `resign` → `game_over`；结束后 `legalMoves` 为空，`phase='finished'`。

### 5.5 悔棋精确语义

| 模式 | 当前回合 | 撤回 plies | 条件 |
| --- | --- | --- | --- |
| `local` | 任意 | 1 | `history.length >= 1` |
| `ai` | 人类（AI 已回复后） | 2 | 撤回后仍必须轮到人类 |
| `ai` | AI（人类刚走、等待/失败） | 1 | 撤回后轮到人类；`ai.thinking=true` 时禁止 |
| 任意 | 已结束 | — | `game_over` |
| 任意 | AI 正在思考 | — | `ai_busy` |

`ai` 模式永远不允许悔棋后留下“轮到 AI”的局面。因此人类执黑时，如果 AI 只走了开局第一手（还没有人类着法），`canUndo=false`。一次 `undo` 无论撤回 1 手还是 2 手，`revision` 只 +1。`restart` 使用最近一次成功的配置，并重置棋盘与历史。

### 5.6 `revision` 与快照语义

- 新 session 的 `welcome` 中 `revision=0`；
- 每个被接受的修改（`new_game`、`move`、`undo`、`restart`、`resign`、AI 自动落子）使 revision +1；
- 人类走子后的 `ai.thinking=true` 快照与触发它的 mutation 拥有**同一个** revision；AI 落子完成后 revision 再 +1；
- AI 失败时只把 `thinking` 改为 false，这是状态变化而非棋局 mutation，因此 revision 不变；
- 服务端只发送**完整** `GameState`，不发送增量补丁。客户端收到乱序/重复帧时应以 `revision` 较新的完整快照为准；
- 同一 revision 可能出现多个 `state`（例如 thinking=true → false 的恢复路径），这是允许的。

## 6. 示例对话

> 为便于阅读，以下示例中的 `pieces`、`legalMoves` 等大数组用 `…` 省略；实际传输的 `GameState` 始终是完整数组，不会包含省略号。

### 6.1 `welcome`

```json
{
  "type": "welcome",
  "info": {
    "name": "Nocturne Chess Server",
    "version": "1.0.0",
    "protocolVersion": 1,
    "aiProviders": [
      {
        "id": "simple",
        "name": "Simple Atelier Engine",
        "description": "Built-in placeholder engine: alpha-beta material search with piece-square scoring. Intended to be replaced by stronger providers.",
        "version": "1.0.0",
        "author": "Nocturne Atelier",
        "capabilities": {
          "difficulties": ["easy", "normal", "hard"],
          "supportsTimeLimit": true,
          "supportsCancellation": true,
          "remote": false
        }
      }
    ]
  },
  "state": {
    "sessionId": "081195c2-e211-4127-a295-d7bfa2e3ced5",
    "revision": 0,
    "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "mode": "local",
    "humanColor": null,
    "ai": null,
    "pieces": ["…32 PieceState…"],
    "turn": "w",
    "phase": "playing",
    "inCheck": false,
    "checkSquare": null,
    "result": null,
    "legalMoves": { "a2": ["a3", "a4"], "e2": ["e3", "e4"], "…": ["…"] },
    "history": [],
    "lastMove": null,
    "canUndo": false,
    "moveNumber": 1
  }
}
```

### 6.2 `new_game`（AI 模式，人类执白）

请求：

```json
{
  "type": "new_game",
  "requestId": "ng-1",
  "config": {
    "mode": "ai",
    "humanColor": "w",
    "ai": { "providerId": "simple", "difficulty": "normal" }
  }
}
```

响应 `state` 要点（`revision=1`）：

```json
{
  "type": "state",
  "requestId": "ng-1",
  "state": {
    "revision": 1,
    "mode": "ai",
    "humanColor": "w",
    "turn": "w",
    "ai": {
      "color": "b",
      "providerId": "simple",
      "providerName": "Simple Atelier Engine",
      "difficulty": "normal",
      "thinking": false
    },
    "history": [],
    "canUndo": false
  }
}
```

### 6.3 人类走子 + AI 回复

请求：`{ "type": "move", "requestId": "m-1", "move": { "from": "e2", "to": "e4" } }`

立即响应（`revision=2`，与人类走子同一 revision）：

```json
{
  "type": "state",
  "requestId": "m-1",
  "state": {
    "revision": 2,
    "turn": "b",
    "ai": { "color": "b", "providerId": "simple", "difficulty": "normal", "thinking": true },
    "history": [{ "index": 0, "moveNumber": 1, "san": "e4", "from": "e2", "to": "e4", "color": "w", "piece": "p" }],
    "lastMove": { "index": 0, "moveNumber": 1, "san": "e4", "from": "e2", "to": "e4", "color": "w", "piece": "p", "pieceId": "w-p5" },
    "canUndo": false
  }
}
```

provider 返回并经后端校验后，服务端再发送 `revision=3`、`ai.thinking=false`、`turn='w'`、`history.length=2` 的完整 `state`（没有 `requestId`）。AI 落子必须是该局面合法着法；后端会重新校验，绝不信任 provider。

### 6.4 `undo`（AI 模式，人类执白）

请求：`{ "type": "undo", "requestId": "u-1" }`

AI 已回复（历史 2 plies）时，响应：

```json
{
  "type": "state",
  "requestId": "u-1",
  "state": {
    "revision": 4,
    "turn": "w",
    "history": [],
    "lastMove": null,
    "canUndo": false,
    "ai": { "color": "b", "providerId": "simple", "difficulty": "normal", "thinking": false }
  }
}
```

### 6.5 错误

```json
{
  "type": "error",
  "requestId": "m-2",
  "error": {
    "code": "not_your_turn",
    "message": "It is b's turn, not yours."
  }
}
```

### 6.6 心跳

请求：`{ "type": "ping", "requestId": "p-1" }`  
响应：`{ "type": "pong", "requestId": "p-1" }`

## 7. 错误码

| `code` | 触发示例 | 客户端建议 |
| --- | --- | --- |
| `bad_request` | 非法 JSON、未知命令、字段类型错误、非法 square、未知 provider、provider 不支持难度、无可悔棋 | 修复命令或查询 `/api/runtime`；可重试不同参数 |
| `unauthorized` | WebSocket 握手 token 缺失/错误（HTTP 401；不作为 WS error 帧） | 重新读取 runtime token 后重连 |
| `invalid_move` | 形状合法但语义不完整，例如兵升变未指定升变棋子 | 要求用户选择升变棋子 |
| `illegal_move` | `from`/`to` 合法但棋规不允许 | 重新渲染 `legalMoves` |
| `not_your_turn` | AI 模式下人类在 AI 回合走子（包括 AI 失败后停留在 AI 回合） | 不可操作；提示用户撤销或重开 |
| `game_over` | 结束后 `move`/`resign`/`undo` | 展示结果；仅允许 `new_game`/`restart` |
| `ai_busy` | AI thinking 时 `move`/`undo` | 禁用输入，等待最终 `state` |
| `unsupported` | 对 `/ws` 发送普通 HTTP GET（426）、未来不支持的特性 | 检查客户端/协议版本 |
| `internal_error` | provider 抛错、返回非法着法、超时、服务端意外异常 | 展示错误；AI 回合可尝试 `undo` 或重开 |

`error` 不会销毁 socket；只有握手失败、超限/网络错误或服务端关闭会断开连接。

## 8. 版本与未来重连

### 8.1 协议版本

- `welcome.info.protocolVersion` 与 HTTP 响应中的 `protocolVersion` 当前均为 `1`；
- 客户端应在 `welcome` 后检查该值；不匹配时拒绝进入对局并提示升级；
- 未来只做**向后兼容**扩展时新增可选字段/消息，不提升主版本；删除/改变现有字段语义时提升 `protocolVersion`；
- 客户端应忽略未知字段，遇到未知 `type` 由服务端返回 `bad_request`，不崩溃。

### 8.2 重连（当前未实现恢复）

当前每个 WebSocket 连接都是全新 session：

- 断线即销毁 session、棋盘、历史；
- 重新连接会收到 revision=0 的 `welcome`；
- 客户端如果只是短暂断线，推荐重新 `new_game`，或未来通过持久会话恢复实现；
- 若未来增加恢复：建议以 `sessionId` + 服务端签名/内存快照为凭据，恢复时返回完整 `GameState`，客户端按 `revision` 丢弃旧快照；不要仅凭 `sessionId` 恢复，必须重新鉴权。

### 8.3 AI 时序约定

可感知的行为参数（服务端选项/常量）：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `aiMoveDelayMs` | `350` | AI 落子最终 `state` 的最小视觉延迟；thinking `state` 立即发送 |
| 硬超时 | `10_000ms` | provider 调用的硬上限；超时后中止并恢复 `thinking=false` |
| `easy` 软预算 | `300ms` | 传给 `AiMoveRequest.timeLimitMs` |
| `normal` 软预算 | `700ms` | 同上 |
| `hard` 软预算 | `1_400ms` | 同上 |

这些值定义在 `apps/server/src/protocol.ts` 与 `apps/server/src/ai/simple-provider.ts`，用于所有 provider（自定义 provider 也会收到同样的 `timeLimitMs`）。内置引擎只是占位实现，详见 `docs/AI_EXTENSION.md`。

## 9. 客户端操作速查

1. `GET /api/runtime` 获取 `wsPath`、`token`；
2. 建立 `ws://…/ws?token=…`；
3. 等待 `welcome`，校验 `info.protocolVersion`；
4. 发送 `new_game` 选择 `local` 或 `ai`（含 `humanColor`、provider、difficulty）；
5. 用户走子前使用 `state.legalMoves`，优先用 `state.turn === humanColor` 判断是否可操作；
6. 处理 `state` 时按 `revision` 更新 UI；AI 的 `thinking` 用于显示“思考中”；
7. 仅当 `canUndo` 为 true 时启用悔棋；收到 `ai_busy` 不重试，等待最终 `state`；
8. 关闭窗口/切换对局时关闭 WebSocket；服务端会中止尚未完成的 AI 任务。
