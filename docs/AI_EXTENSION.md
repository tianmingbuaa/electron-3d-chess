# AI Provider 扩展指南

`@nocturne/chess-server` 通过 `AiProvider` SPI（Service Provider Interface）支持替换/追加棋力更强的引擎。协议类型定义在 `packages/shared/src/index.ts`，服务端实现位于 `apps/server/src/ai/`。

> **重要：内置的 "Simple Atelier Engine" 只是占位实现（placeholder）**。它使用浅层 alpha-beta、材料价值和简单 piece-square 表，主要目标是“合法、可取消、响应及时”，**不是**一个有竞争力的国际象棋引擎。生产对局体验应替换为 Stockfish、Maia、远程服务或其他更强实现。

## 1. SPI 契约

来自 `@nocturne/chess-shared` 的核心接口：

```ts
export interface AiProviderInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  capabilities: AiProviderCapabilities;
}

export interface AiProviderCapabilities {
  difficulties: AiDifficulty[];   // 'easy' | 'normal' | 'hard'
  supportsTimeLimit: boolean;
  supportsCancellation: boolean;
  remote: boolean;                // 是否调用网络/外部服务
}

export interface AiMoveRequest {
  fen: string;
  color: Color;                   // AI 执色
  turn: Color;                    // 当前走子方（正常应等于 color）
  history: MoveRecord[];
  legalMoves: LegalMove[];        // 含全部升变分支
  difficulty: AiDifficulty;
  timeLimitMs: number;            // 软预算
  signal: AbortSignal;            // 取消信号
}

export interface AiMoveChoice {
  from: Square;
  to: Square;
  promotion?: PromotionPieceType;
  san?: string;                   // 仅作参考，服务端以 from/to/promotion 为准
  evaluationCp?: number;          // 可选遥测
  depth?: number;                 // 可选遥测
  nodes?: number;                 // 可选遥测
  providerData?: unknown;         // 可选私有数据（当前不会下发给客户端）
}

export interface AiProvider {
  readonly info: AiProviderInfo;
  init?(): Promise<void> | void;
  chooseMove(request: AiMoveRequest): Promise<AiMoveChoice | null>;
  dispose?(): Promise<void> | void;
}
```

`chooseMove` 必须是**无副作用**的：不要改服务端棋盘、不要依赖内部全局可变局面；只返回一个建议着法，由 `ChessGame` 验证并应用。

## 2. 注册与合并

服务端使用 `AiProviderRegistry`。默认 registry 总是先注册内置 provider，再按 `createChessServer({ aiProviders })` 的顺序注册额外 provider：

```ts
import {
  createChessServer,
  AiProviderRegistry,
  createAiProviderRegistry,
} from '@nocturne/chess-server';

// 方式 A：直接交给服务器（推荐）
const server = await createChessServer({
  port: 0,
  aiMoveDelayMs: 350,
  aiProviders: [new MyEngine()],
  // 可选：客户端不指定 ai 时默认使用该 provider
  defaultAiProviderId: 'my-engine',
});
```

```ts
// 方式 B：自行构建 registry 并直接驱动 Session/测试
const registry = createAiProviderRegistry([new MyEngine()]);
registry.get('my-engine');
registry.list();                        // 克隆后的 AiProviderInfo[]
registry.supportsDifficulty('my-engine', 'hard');
registry.register(anotherProvider);     // 重复 id 会抛错
registry.unregister('another-provider');
```

| 方法 | 行为 |
| --- | --- |
| `register(provider)` | 校验 `info`/`capabilities`，重复 `id` 抛 `Error` |
| `unregister(id)` | 移除，返回是否曾存在；内置 provider 也可移除 |
| `get(id)` / `require(id)` | 返回实例 / 不存在时抛错 |
| `info(id)` | 返回克隆的元数据 |
| `list()` | 注册顺序的 `AiProviderInfo[]` |
| `supportsDifficulty(id, difficulty)` | 依据 `capabilities.difficulties` |
| `initialize()` | 依次调用各 provider 的 `init()`；失败回滚并抛错 |
| `disposeAll()` | 调用 `dispose()`；聚合错误后抛出 |

**重复 ID（包括与内置 `simple` 冲突）会在服务启动阶段同步失败**，这是故意的：避免静默覆盖。`defaultAiProviderId` 在服务启动时也会校验存在性。

## 3. 生命周期、时序与取消

一次 AI 回合的时间线：

```
人类 move 被接受
   │
   ├─ revision +1，发送 state { ai.thinking: true, turn: AI }
   │
   ├─ GameSession 构造 AiMoveRequest（fen/history/legalMoves/signal/timeLimit）
   │
   ├─ provider.chooseMove(request)         ← 后端异步调用
   │      ├─ 最小视觉延迟 aiMoveDelayMs（默认 350ms）
   │      └─ 硬超时 10s：超时则 AbortController.abort()
   │
   ├─ 校验返回着法（必须是当前局面合法着法）
   ├─ ChessGame.applyMove（再次权威校验）
   └─ revision +1，发送 state { ai.thinking: false }
```

具体保证：

1. **初始化**：`createChessServer` 在监听端口之前调用 `registry.initialize()`。任一 `init()` 抛错会让启动失败，不会给你一个“半初始化”的服务器。`close()` 最后调用 `registry.disposeAll()`。
2. **单会话串行**：同一 WebSocket session 中同一时刻最多一个 AI 任务；`startAi` 会先中止旧任务。不同连接/不同 session 可以并行。
3. **最小延迟**：thinking 快照立即发送；最终落子/失败状态至少等待 `aiMoveDelayMs`（不是额外固定 sleep，provider 本身耗时更长时不再追加）。
4. **取消**：`AbortController.abort()` 会发生在 `new_game`、`restart`、`undo`、连接断开、`resign` 时。`undo` 在 thinking 期间会被拒绝（`ai_busy`），因此不会出现“悔棋同时让 AI 继续想”的竞态。
5. **generation 防护**：每次任务有递增 generation。被取消任务的迟到结果即使返回也会被丢弃，不会污染新对局。
6. **硬超时**：默认 `10_000ms`。超时后服务端先恢复 `ai.thinking=false`，发送带 `notice` 的 `state`，再发送 `internal_error`。即使 provider 完全忽略 `signal`，竞速超时也会让 session 继续工作。
7. **失败恢复**：provider 抛错、返回 `null`、返回非法/格式错误着法、或超时，都进入同一恢复路径：不修改棋局，`ai.thinking=false`，error 码为 `internal_error`。如果此前有人类着法，AI 回合下 `canUndo=true`，客户端可以撤销一手回到人类回合。
8. **不信任输出**：`from`/`to`/`promotion` 会被 `ChessGame.applyMove` 按权威规则再次校验；AI 的 `san` 不会被用于执行。
9. **单线程阻塞警告**：`chooseMove` 在 Node.js 主线程上执行（除非你自己把重计算放入 `worker_threads` / child process）。同步阻塞会卡住 WebSocket、HTTP 与其他 session。任何超过几十毫秒的搜索都应放入 worker/子进程，或改用远程引擎。

## 4. 难度、能力与校验

- 难度只有三种：`easy` / `normal` / `hard`。注册时 `capabilities.difficulties` 必须非空且只包含这些值，否则注册抛错。
- 开始 AI 对局时，`GameSession` 会校验：
  1. `providerId` 必须已注册；
  2. `capabilities.difficulties` 必须包含请求的难度；
  3. 任一失败返回 `bad_request`（不会开始对局）。
- `supportsTimeLimit` / `supportsCancellation` 是**能力声明**，当前服务端不会因此拒绝 provider；无论声明如何，`AiMoveRequest.timeLimitMs` 与 `signal` 都会提供，硬超时始终生效。声明为 `false` 时应自觉忽略相应参数，不要假装支持。
- `remote: true` 目前只用于元数据展示（`welcome.info.aiProviders`），客户端可据此展示“远程引擎”标签或提示网络风险。

服务端传入的软预算（所有 provider 相同）：

| difficulty | `timeLimitMs` |
| --- | --- |
| `easy` | 300 |
| `normal` | 700 |
| `hard` | 1400 |

这些值来自 `SIMPLE_AI_TIME_BUDGET_MS`。自定义 provider 可以更保守，但不应超过软预算太多；硬上限仍是 10s。

## 5. 最小 provider 示例

```ts
import type {
  AiMoveChoice,
  AiMoveRequest,
  AiProvider,
  AiProviderInfo,
} from '@nocturne/chess-shared';

const info: AiProviderInfo = {
  id: 'my-engine',
  name: 'My Atelier Engine',
  description: 'A custom engine served over HTTP.',
  version: '1.0.0',
  author: 'My Team',
  capabilities: {
    difficulties: ['easy', 'normal', 'hard'],
    supportsTimeLimit: true,
    supportsCancellation: true,
    remote: true,
  },
};

export class MyEngine implements AiProvider {
  readonly info = info;

  async init(): Promise<void> {
    // 预热连接、加载模型文件、检查引擎可执行文件等。
    // 抛错会让 createChessServer 启动失败。
  }

  async chooseMove(request: AiMoveRequest): Promise<AiMoveChoice | null> {
    if (request.signal.aborted) {
      throw new DOMException('AI search aborted', 'AbortError');
    }

    const response = await fetch('http://127.0.0.1:9999/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fen: request.fen,
        difficulty: request.difficulty,
        timeLimitMs: request.timeLimitMs,
      }),
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(9_000),
      ]),
    });

    if (!response.ok) {
      throw new Error(`Engine service failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      from?: unknown;
      to?: unknown;
      promotion?: unknown;
    };
    if (typeof payload.from !== 'string' || typeof payload.to !== 'string') {
      throw new Error('Engine service returned a malformed move');
    }
    if (
      payload.promotion !== undefined &&
      payload.promotion !== 'q' &&
      payload.promotion !== 'r' &&
      payload.promotion !== 'b' &&
      payload.promotion !== 'n'
    ) {
      throw new Error('Engine service returned an invalid promotion piece');
    }

    // 可选：用 request.legalMoves 在本地先筛一遍，减少一次往返。
    return {
      from: payload.from as AiMoveChoice['from'],
      to: payload.to as AiMoveChoice['to'],
      ...(payload.promotion === undefined
        ? {}
        : { promotion: payload.promotion }),
    };
  }

  async dispose(): Promise<void> {
    // 关闭连接池、终止 worker 等。
  }
}
```

注册：

```ts
const server = await createChessServer({
  aiProviders: [new MyEngine()],
  defaultAiProviderId: 'my-engine', // 可选；缺省仍是 'simple'
});
```

客户端随后发送：

```json
{
  "type": "new_game",
  "config": {
    "mode": "ai",
    "humanColor": "w",
    "ai": { "providerId": "my-engine", "difficulty": "normal" }
  }
}
```

## 6. 接入远程引擎

推荐把远程引擎做成“薄适配器”，并在服务端再次校验：

1. 远程接口只接受 `fen`、`difficulty`、预算；返回 `from/to/promotion`（或用 UCI 字符串并在客户端转换）。
2. 用 `AbortSignal.any([request.signal, AbortSignal.timeout(...)])` 或手动 `AbortController` 合并取消与超时。
3. 对 HTTP 非 2xx、超时、JSON 结构错误一律抛错，交给 session 的失败恢复路径。
4. 不要把 token、Cookie、内网凭据发送给不可信引擎；生产环境使用 TLS 与内网鉴权。
5. 状态码/错误响应要短，避免把堆栈返回给客户端（session 会把 error.message 截断到 300 字符）。
6. 如果远程服务返回 UCI（如 `e2e4`、`e7e8q`），在 provider 内解析：

```ts
function parseUci(uci: string): AiMoveChoice | null {
  const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci);
  if (!match) return null;
  const [, from, to, promotion] = match;
  return {
    from: from as AiMoveChoice['from'],
    to: to as AiMoveChoice['to'],
    ...(promotion === undefined
      ? {}
      : { promotion: promotion as 'q' | 'r' | 'b' | 'n' }),
  };
}
```

仅解析成功还不够：session 会以当前局面合法着法为准再次校验。

## 7. Stockfish UCI 子进程概念（未内置）

当前仓库**没有**集成 Stockfish，也没有新增依赖。若你实现一个 `StockfishProvider`，推荐流程：

1. 通过环境变量或显式配置提供引擎路径（例如 `STOCKFISH_PATH`），不要拼接用户输入到 shell 命令；用 `child_process.spawn(path, [], { stdio: 'pipe' })`，禁止 `shell: true`。
2. `init()` 启动一个或一池进程：写 `uci\n`，等待 `uciok`，写 `isready\n`，等待 `readyok`。可设置 `setoption name Threads value 1`、`Hash` 等资源上限。
3. 每局/每步：`ucinewgame` → `position fen <request.fen>` → `go movetime <request.timeLimitMs>`（或 `go depth`）。
4. 读取 stdout，直到 `bestmove e2e4` / `bestmove e7e8q` / `bestmove (none)`；转换为 `AiMoveChoice`。
5. 用一个串行队列保证同一进程不并发搜索；不同 provider/session 可以用池化进程。
6. 取消：监听 `request.signal`，收到后写 `stop\n`，等待 `bestmove` 或短暂 grace 后 `kill('SIGTERM')`；清理 stdout buffer，防止串话。
7. `dispose()` 关闭所有进程并等待退出；`init()` 失败时不要泄漏子进程。
8. 能力声明：`remote: false`（本地子进程），`supportsCancellation: true`，`supportsTimeLimit: true`。
9. 打包/许可：Stockfish 是 GPLv3 软件，分发包、版本、许可证与 Electron 打包策略需单独评估；不要把未经许可的二进制随意提交进仓库。

伪代码（概念，不是可直接编译的完整实现）：

```ts
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

class StockfishProvider implements AiProvider {
  private process: ChildProcessWithoutNullStreams | null = null;
  private queue = Promise.resolve();

  async init(): Promise<void> {
    this.process = spawn(process.env.STOCKFISH_PATH ?? 'stockfish', [], {
      stdio: 'pipe',
    });
    // send 'uci', await 'uciok', send 'isready', await 'readyok'
  }

  chooseMove(request: AiMoveRequest): Promise<AiMoveChoice | null> {
    // serialize engine commands; write 'position fen ...' + 'go movetime ...';
    // parse 'bestmove ...'; handle request.signal -> 'stop'
    throw new Error('concept only');
  }

  async dispose(): Promise<void> {
    this.process?.kill('SIGTERM');
    this.process = null;
  }
}
```

## 8. 测试契约

建议每个 provider 至少覆盖：

1. **合法着法**：从 `ChessGame` 当前局面构造 `AiMoveRequest`，调用 `chooseMove`，把结果应用到独立 `ChessGame`，不得抛错；并用 `request.legalMoves` 的 `{from,to,promotion}` 集合复核。
2. **取消**：预先 abort 的 `AbortSignal` 应快速以 `AbortError` 拒绝（内置实现与测试均如此）；若 provider 是异步的，再测运行中 abort。
3. **时间预算**：传较小的 `timeLimitMs`，断言在合理时间内返回合法着法（不要断言精确节点数或毫秒）。
4. **响应式**：对 `hard` 难度在普通初始局面上的耗时设一个宽松上限（例如 5s），防止调用方被挂死。
5. **确定性**：算法中的随机性通过构造函数注入 `random: () => number`（内置 `SimpleAiProvider` 支持），测试固定 RNG；不要让测试依赖随机选中的具体着法。
6. **元数据**：`info.id` 唯一、难度覆盖、`capabilities` 真实。
7. **失败路径**：抛错/返回非法着法时，集成测试应确保 session 发送 `state`（thinking=false）和 `internal_error`，且不崩溃。
8. **集成**：用 `createChessServer({ port: 0, aiMoveDelayMs: 0, aiProviders: [provider] })` 启动真实 WebSocket；收到 `welcome` → `new_game` → 人类走子 → 断言 exactly 一个 AI 回复（revision/history 增长一次）→ `undo` 回到人类回合。

参考实现：`apps/server/src/ai/simple-provider.ts`；参考测试：`apps/server/test/ai.test.ts`、`apps/server/test/integration.test.ts`。

## 9. 安全与性能准则

- **绝不信任引擎输出**：`from/to/promotion` 必须由服务端合法着法校验；不要直接 `applyMove` 未校验字符串。
- **不要阻塞事件循环**：Node 主线程上的重搜索会冻结所有 session、HTTP 静态资源和心跳。深度搜索、模型推理、Stockfish 必须在 `worker_threads`、子进程或远端执行。
- **取消要及时**：`signal` 触发后尽快结束；对无法中断的同步搜索，至少频繁检查 `Date.now()` 与 `signal.aborted`。
- **资源上限**：限制节点数、内存、线程数、并发进程数和远程响应大小；内置引擎有 `MAX_NODES` 与 `MAX_SEARCH_MS`。
- **远程安全**：TLS、鉴权、请求超时、响应大小限制；不要发送本地 token；不要把远程错误原样泄漏给 renderer（服务端已截断）。
- **进程安全**：Stockfish 路径来自可信配置，禁止 `shell: true` 和拼接用户字符串；取消/退出时清理子进程。
- **日志**：不要记录 token、局面隐私或完整远程响应；session 只记录 provider 失败摘要。
- **生命周期**：`new_game`/`restart`/断线/`resign` 会中止 AI；provider 的 `dispose()` 必须幂等、快速，避免关闭服务器时挂起。

## 10. 内置占位引擎说明

- 类/工厂：`SimpleAiProvider` / `createSimpleAiProvider()`；常量 `SIMPLE_AI_PROVIDER_INFO`。
- `id: 'simple'`，`name: "Simple Atelier Engine"`，本地（`remote: false`）。
- 算法：alpha-beta negamax + 材料价值 + piece-square 表 + 吃子优先排序 + iterative deepening；根节点在 `best - 15cp` 内随机选择，制造一点变化。
- 深度：`easy=1`、`normal=2`、`hard=3`；软预算 300/700/1400ms；节点上限 250k；内部搜索硬上限 9s。
- 返回可选 `depth`、`nodes`、`evaluationCp`；不返回 `providerData`。
- 它只是让产品在真实引擎接入前可用：不包含开局库、残局库、置换表、静态搜索或深度战术，棋力显著低于 Stockfish。**请在产品定位中明确它只是占位实现，并根据需要替换。**
