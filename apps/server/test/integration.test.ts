import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { describe, expect, it } from 'vitest';
import type {
  AiMoveChoice,
  AiMoveRequest,
  AiProvider,
  AiProviderInfo,
  GameState,
  ServerMessage,
} from '@nocturne/chess-shared';
import {
  createChessServer,
  type ChessServer,
  type CreateChessServerOptions,
} from '../src/index';

/* ---------------------------------------------------------------------- */
/*                              Test helpers                              */
/* ---------------------------------------------------------------------- */

async function startServer(
  overrides: Partial<CreateChessServerOptions> = {},
): Promise<ChessServer> {
  return createChessServer({
    port: 0,
    aiMoveDelayMs: 0,
    log: () => {
      // Keep test output quiet.
    },
    ...overrides,
  });
}

function wsUrl(server: ChessServer, token: string | null = server.token): string {
  const base = `${server.url.replace(/^http/, 'ws')}/ws`;
  return token === null ? base : `${base}?token=${encodeURIComponent(token)}`;
}

interface Waiter {
  predicate: (message: ServerMessage) => boolean;
  resolve: (message: ServerMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class TestClient {
  private readonly queue: ServerMessage[] = [];
  private waiter: Waiter | null = null;

  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (data) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(data)) as ServerMessage;
      } catch (error) {
        this.failWaiters(
          error instanceof Error ? error : new Error('Invalid server JSON.'),
        );
        return;
      }
      if (this.waiter !== null) {
        if (this.waiter.predicate(message)) {
          const waiter = this.waiter;
          this.waiter = null;
          clearTimeout(waiter.timer);
          waiter.resolve(message);
          return;
        }
      }
      this.queue.push(message);
    });

    ws.on('close', () => {
      this.failWaiters(new Error('WebSocket closed while waiting for a message.'));
    });
    ws.on('error', (error) => {
      this.failWaiters(error instanceof Error ? error : new Error(String(error)));
    });
  }

  static async connect(url: string, timeoutMs = 5_000): Promise<TestClient> {
    const ws = new WebSocket(url);
    const client = new TestClient(ws);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error(`Timed out opening WebSocket ${url}.`));
      }, timeoutMs);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      ws.once('unexpected-response', (_request, response) => {
        clearTimeout(timer);
        response.resume();
        ws.terminate();
        reject(new Error(`Unexpected HTTP ${response.statusCode ?? 0} opening ${url}.`));
      });
    });
    return client;
  }

  send(message: unknown): void {
    this.ws.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  next(
    predicate: (message: ServerMessage) => boolean = () => true,
    timeoutMs = 5_000,
  ): Promise<ServerMessage> {
    const index = this.queue.findIndex(predicate);
    if (index >= 0) {
      const [message] = this.queue.splice(index, 1);
      if (message !== undefined) return Promise.resolve(message);
    }
    if (this.waiter !== null) {
      return Promise.reject(new Error('Concurrent TestClient.next() calls are not supported.'));
    }
    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.waiter !== null && this.waiter.timer === timer) {
          this.waiter = null;
        }
        const queued = this.queue.map((entry) => entry.type).join(', ') || '(none)';
        reject(
          new Error(
            `Timed out after ${timeoutMs}ms waiting for a server message. Queued: ${queued}.`,
          ),
        );
      }, timeoutMs);
      this.waiter = { predicate, resolve, reject, timer };
    });
  }

  nextState(
    predicate: (state: GameState) => boolean = () => true,
    timeoutMs = 5_000,
  ): Promise<GameState> {
    return this.next(
      (message) => message.type === 'state' && predicate(message.state),
      timeoutMs,
    ).then((message) => {
      if (message.type !== 'state') throw new Error('Expected a state message.');
      return message.state;
    });
  }

  queuedStates(): GameState[] {
    return this.queue
      .filter((message): message is Extract<ServerMessage, { type: 'state' }> =>
        message.type === 'state',
      )
      .map((message) => message.state);
  }

  close(): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    } else if (this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.terminate();
    }
  }

  private failWaiters(error: Error): void {
    if (this.waiter !== null) {
      const waiter = this.waiter;
      this.waiter = null;
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}

async function upgradeStatus(url: string, timeoutMs = 5_000): Promise<number> {
  const ws = new WebSocket(url);
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Timed out waiting for upgrade rejection at ${url}.`));
    }, timeoutMs);
    ws.once('unexpected-response', (_request, response) => {
      clearTimeout(timer);
      const status = response.statusCode ?? 0;
      response.resume();
      ws.terminate();
      resolve(status);
    });
    ws.once('open', () => {
      clearTimeout(timer);
      ws.close();
      reject(new Error('WebSocket unexpectedly opened.'));
    });
    ws.once('error', () => {
      // `ws` may also emit error when an unexpected response listener exists.
    });
  });
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function expectWelcome(message: ServerMessage): void {
  expect(message.type).toBe('welcome');
  if (message.type !== 'welcome') return;
  expect(message.info.protocolVersion).toBe(1);
  expect(message.info.name).toBe('Nocturne Chess Server');
  expect(message.info.aiProviders.map((provider) => provider.id)).toContain('simple');
  expect(message.state.revision).toBe(0);
  expect(message.state.mode).toBe('local');
  expect(message.state.humanColor).toBeNull();
  expect(message.state.ai).toBeNull();
  expect(message.state.pieces).toHaveLength(32);
  expect(message.state.history).toEqual([]);
  expect(message.state.legalMoves.e2).toEqual(['e3', 'e4']);
  expect(message.state.sessionId).toMatch(/[0-9a-f-]{20,}/i);
}

/* ---------------------------------------------------------------------- */
/*                                 Tests                                  */
/* ---------------------------------------------------------------------- */

describe('HTTP API and authentication', () => {
  it('serves uncached health/runtime info and rejects bad WS tokens', async () => {
    const server = await startServer();
    let client: TestClient | undefined;
    try {
      const healthResponse = await fetch(`${server.url}/api/health`);
      expect(healthResponse.status).toBe(200);
      expect(healthResponse.headers.get('cache-control')).toContain('no-store');
      expect(healthResponse.headers.get('x-content-type-options')).toBe('nosniff');
      const health = (await healthResponse.json()) as {
        ok: boolean;
        serverName: string;
        protocolVersion: number;
        uptimeSeconds: number;
      };
      expect(health.ok).toBe(true);
      expect(health.serverName).toBe('Nocturne Chess Server');
      expect(health.protocolVersion).toBe(1);
      expect(health.uptimeSeconds).toBeGreaterThanOrEqual(0);

      const runtimeResponse = await fetch(`${server.url}/api/runtime`);
      expect(runtimeResponse.status).toBe(200);
      expect(runtimeResponse.headers.get('cache-control')).toContain('no-store');
      const runtime = (await runtimeResponse.json()) as {
        wsPath: string;
        token: string;
        protocolVersion: number;
      };
      expect(runtime.wsPath).toBe('/ws');
      expect(runtime.token).toBe(server.token);
      expect(runtime.protocolVersion).toBe(1);

      const missingApi = await fetch(`${server.url}/api/does-not-exist`);
      expect(missingApi.status).toBe(404);
      expect(await missingApi.json()).toMatchObject({
        error: { code: 'bad_request' },
      });

      expect(await upgradeStatus(wsUrl(server, 'wrong-token'))).toBe(401);
      expect(await upgradeStatus(wsUrl(server, null))).toBe(401);

      client = await TestClient.connect(wsUrl(server));
      expectWelcome(await client.next((message) => message.type === 'welcome'));
    } finally {
      client?.close();
      await server.close();
    }
  });
});

describe('WebSocket AI game flow', () => {
  it('runs a full AI game, validates the AI move and undoes to the human turn', async () => {
    const server = await startServer();
    const client = await TestClient.connect(wsUrl(server));
    try {
      expectWelcome(await client.next((message) => message.type === 'welcome'));

      client.send({
        type: 'new_game',
        requestId: 'new-1',
        config: {
          mode: 'ai',
          humanColor: 'w',
          ai: { providerId: 'simple', difficulty: 'normal' },
        },
      });
      const newGameState = await client.nextState(
        (state) => state.revision === 1,
      );
      expect(newGameState).toMatchObject({
        mode: 'ai',
        humanColor: 'w',
        turn: 'w',
        phase: 'playing',
        revision: 1,
        history: [],
      });
      expect(newGameState.ai).toMatchObject({
        color: 'b',
        providerId: 'simple',
        providerName: 'Simple Atelier Engine',
        difficulty: 'normal',
        thinking: false,
      });

      client.send({
        type: 'move',
        requestId: 'move-1',
        move: { from: 'e2', to: 'e4' },
      });
      const thinking = await client.nextState(
        (state) => state.revision === 2,
      );
      expect(thinking.turn).toBe('b');
      expect(thinking.history).toHaveLength(1);
      expect(thinking.history[0]?.san).toBe('e4');
      expect(thinking.ai?.thinking).toBe(true);
      expect(thinking.canUndo).toBe(false);

      const reply = await client.nextState(
        (state) => state.ai?.thinking === false && state.history.length === 2,
      );
      expect(reply.revision).toBe(3);
      expect(reply.turn).toBe('w');
      expect(reply.phase).toBe('playing');
      expect(reply.history).toHaveLength(2);
      expect(reply.history[1]?.color).toBe('b');
      expect(reply.ai?.thinking).toBe(false);
      expect(reply.lastMove).not.toBeNull();

      // The authoritative legal-move map from the AI's turn proves the reply
      // was legal without trusting provider output.
      if (reply.lastMove !== null) {
        expect(thinking.legalMoves[reply.lastMove.from]).toContain(reply.lastMove.to);
      }
      expect(reply.canUndo).toBe(true);

      client.send({ type: 'undo', requestId: 'undo-1' });
      const undone = await client.nextState((state) => state.revision === 4);
      expect(undone.turn).toBe('w');
      expect(undone.history).toEqual([]);
      expect(undone.lastMove).toBeNull();
      expect(undone.canUndo).toBe(false);
      expect(undone.ai?.thinking).toBe(false);

      client.send({ type: 'ping', requestId: 'ping-1' });
      expect(await client.next((message) => message.type === 'pong')).toEqual({
        type: 'pong',
        requestId: 'ping-1',
      });
    } finally {
      client.close();
      await server.close();
    }
  });

  it('starts AI automatically when the human plays black and keeps undo safe', async () => {
    const server = await startServer();
    const client = await TestClient.connect(wsUrl(server));
    try {
      await client.next((message) => message.type === 'welcome');

      client.send({
        type: 'new_game',
        requestId: 'black-game',
        config: {
          mode: 'ai',
          humanColor: 'b',
          ai: { providerId: 'simple', difficulty: 'normal' },
        },
      });
      const thinking = await client.nextState((state) => state.revision === 1);
      expect(thinking.humanColor).toBe('b');
      expect(thinking.turn).toBe('w');
      expect(thinking.ai).toMatchObject({ color: 'w', thinking: true });
      expect(thinking.history).toEqual([]);

      const reply = await client.nextState(
        (state) => state.ai?.thinking === false && state.history.length === 1,
      );
      expect(reply.revision).toBe(2);
      expect(reply.turn).toBe('b');
      expect(reply.history[0]?.color).toBe('w');
      expect(reply.lastMove).not.toBeNull();
      // Taking back the AI's first move would leave the AI to move, so undo is
      // intentionally unavailable here.
      expect(reply.canUndo).toBe(false);
      client.send({ type: 'undo', requestId: 'undo-ai-first' });
      expect(await client.next((message) => message.type === 'error')).toMatchObject({
        requestId: 'undo-ai-first',
        error: { code: 'bad_request' },
      });

      // Restart keeps the configured sides and lets the AI open again.
      client.send({ type: 'restart', requestId: 'restart-black' });
      const restarted = await client.nextState((state) => state.revision === 3);
      expect(restarted.revision).toBe(3);
      expect(restarted.humanColor).toBe('b');
      expect(restarted.turn).toBe('w');
      expect(restarted.history).toEqual([]);
      expect(restarted.ai?.thinking).toBe(true);
      await client.nextState(
        (state) => state.ai?.thinking === false && state.revision === 4,
      );
    } finally {
      client.close();
      await server.close();
    }
  });

  it('recovers coherently when an AI provider fails', async () => {
    const failingInfo: AiProviderInfo = {
      id: 'failing',
      name: 'Failing Test Engine',
      description: 'Always throws, used to verify failure recovery.',
      version: '1.0.0',
      capabilities: {
        difficulties: ['easy', 'normal', 'hard'],
        supportsTimeLimit: true,
        supportsCancellation: true,
        remote: false,
      },
    };
    const failing: AiProvider = {
      info: failingInfo,
      async chooseMove(): Promise<AiMoveChoice | null> {
        throw new Error('intentional provider failure');
      },
    };

    const server = await startServer({ aiProviders: [failing] });
    const client = await TestClient.connect(wsUrl(server));
    try {
      await client.next((message) => message.type === 'welcome');

      client.send({
        type: 'new_game',
        requestId: 'failing-game',
        config: {
          mode: 'ai',
          humanColor: 'w',
          ai: { providerId: 'failing', difficulty: 'easy' },
        },
      });
      await client.nextState((state) => state.revision === 1);

      client.send({
        type: 'move',
        requestId: 'human-e4',
        move: { from: 'e2', to: 'e4' },
      });
      const thinking = await client.nextState((state) => state.revision === 2);
      expect(thinking.ai?.thinking).toBe(true);

      const failed = await client.nextState(
        (state) => state.ai?.thinking === false && state.history.length === 1,
      );
      expect(failed.revision).toBe(2);
      expect(failed.result).toBeNull();
      expect(failed.turn).toBe('b');
      expect(failed.canUndo).toBe(true);
      expect(failed.ai).toMatchObject({
        providerId: 'failing',
        providerName: 'Failing Test Engine',
        thinking: false,
      });

      const error = await client.next(
        (message) => message.type === 'error',
      );
      expect(error).toMatchObject({
        type: 'error',
        error: { code: 'internal_error' },
      });
      if (error.type === 'error') {
        expect(error.error.message).toContain('intentional provider failure');
      }

      // The game is left coherent on the AI's turn, not desynchronised.
      client.send({
        type: 'move',
        requestId: 'wrong-turn',
        move: { from: 'd2', to: 'd4' },
      });
      expect(await client.next((message) => message.type === 'error')).toMatchObject({
        requestId: 'wrong-turn',
        error: { code: 'not_your_turn' },
      });

      client.send({ type: 'undo', requestId: 'recover-undo' });
      const recovered = await client.nextState((state) => state.revision === 3);
      expect(recovered.turn).toBe('w');
      expect(recovered.history).toEqual([]);
      expect(recovered.canUndo).toBe(false);
    } finally {
      client.close();
      await server.close();
    }
  });

  it('plays both sides in local mode and undoes a single ply', async () => {
    const server = await startServer();
    const client = await TestClient.connect(wsUrl(server));
    try {
      await client.next((message) => message.type === 'welcome');

      client.send({
        type: 'move',
        requestId: 'w-move',
        move: { from: 'e2', to: 'e4' },
      });
      const afterWhite = await client.nextState((state) => state.revision === 1);
      expect(afterWhite.turn).toBe('b');
      expect(afterWhite.history).toHaveLength(1);

      client.send({
        type: 'move',
        requestId: 'b-move',
        move: { from: 'e7', to: 'e5' },
      });
      const afterBlack = await client.nextState((state) => state.revision === 2);
      expect(afterBlack.turn).toBe('w');
      expect(afterBlack.history).toHaveLength(2);
      expect(afterBlack.canUndo).toBe(true);

      client.send({ type: 'undo', requestId: 'undo-local' });
      const undone = await client.nextState((state) => state.revision === 3);
      expect(undone.turn).toBe('b');
      expect(undone.history).toHaveLength(1);
      expect(undone.history[0]?.san).toBe('e4');
      expect(undone.canUndo).toBe(true);
    } finally {
      client.close();
      await server.close();
    }
  });

  it('rejects malformed/illegal input without closing the socket', async () => {
    const server = await startServer();
    const client = await TestClient.connect(wsUrl(server));
    try {
      await client.next((message) => message.type === 'welcome');

      client.send('{not json');
      expect(await client.next((message) => message.type === 'error')).toMatchObject({
        type: 'error',
        error: { code: 'bad_request' },
      });

      client.send({ type: 'teleport', requestId: 'unknown' });
      expect(await client.next((message) => message.type === 'error')).toMatchObject({
        type: 'error',
        requestId: 'unknown',
        error: { code: 'bad_request' },
      });

      client.send({
        type: 'move',
        requestId: 'bad-square',
        move: { from: 'z9', to: 'e4' },
      });
      expect(await client.next((message) => message.type === 'error')).toMatchObject({
        requestId: 'bad-square',
        error: { code: 'bad_request' },
      });

      client.send({
        type: 'move',
        requestId: 'illegal',
        move: { from: 'e2', to: 'e5' },
      });
      expect(await client.next((message) => message.type === 'error')).toMatchObject({
        requestId: 'illegal',
        error: { code: 'illegal_move' },
      });

      client.send({
        type: 'new_game',
        requestId: 'missing-provider',
        config: {
          mode: 'ai',
          ai: { providerId: 'nope', difficulty: 'normal' },
        },
      });
      expect(await client.next((message) => message.type === 'error')).toMatchObject({
        requestId: 'missing-provider',
        error: { code: 'bad_request' },
      });

      client.send({ type: 'ping', requestId: 'still-alive' });
      expect(await client.next((message) => message.type === 'pong')).toMatchObject({
        type: 'pong',
        requestId: 'still-alive',
      });

      client.send({ type: 'undo', requestId: 'nothing' });
      expect(await client.next((message) => message.type === 'error')).toMatchObject({
        requestId: 'nothing',
        error: { code: 'bad_request' },
      });
    } finally {
      client.close();
      await server.close();
    }
  });

  it('validates unsupported difficulty and aborts AI work when resigning', async () => {
    const onlyEasyInfo: AiProviderInfo = {
      id: 'only-easy',
      name: 'Only Easy',
      description: 'Integration test provider.',
      version: '1.0.0',
      capabilities: {
        difficulties: ['easy'],
        supportsTimeLimit: true,
        supportsCancellation: true,
        remote: false,
      },
    };
    const onlyEasy: AiProvider = {
      info: onlyEasyInfo,
      async chooseMove(): Promise<AiMoveChoice | null> {
        return null;
      },
    };

    let aborted = false;
    const slowInfo: AiProviderInfo = {
      ...onlyEasyInfo,
      id: 'slow',
      name: 'Slow Test Engine',
      description: 'Waits before answering so cancellation can be observed.',
    };
    const slow: AiProvider = {
      info: slowInfo,
      chooseMove(request: AiMoveRequest): Promise<AiMoveChoice | null> {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            const move = request.legalMoves[0];
            resolve(move ?? null);
          }, 250);
          request.signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              clearTimeout(timer);
              reject(new DOMException('aborted', 'AbortError'));
            },
            { once: true },
          );
        });
      },
    };

    const server = await startServer({ aiProviders: [onlyEasy, slow] });
    const client = await TestClient.connect(wsUrl(server));
    try {
      await client.next((message) => message.type === 'welcome');

      client.send({
        type: 'new_game',
        requestId: 'bad-difficulty',
        config: {
          mode: 'ai',
          ai: { providerId: 'only-easy', difficulty: 'hard' },
        },
      });
      expect(await client.next((message) => message.type === 'error')).toMatchObject({
        requestId: 'bad-difficulty',
        error: { code: 'bad_request' },
      });

      client.send({
        type: 'new_game',
        requestId: 'slow-game',
        config: {
          mode: 'ai',
          humanColor: 'w',
          ai: { providerId: 'slow', difficulty: 'easy' },
        },
      });
      await client.nextState((state) => state.revision === 1);

      client.send({
        type: 'move',
        requestId: 'human-move',
        move: { from: 'e2', to: 'e4' },
      });
      const thinking = await client.nextState((state) => state.revision === 2);
      expect(thinking.ai?.thinking).toBe(true);

      // The human may not move while the provider is thinking.
      client.send({
        type: 'move',
        requestId: 'too-fast',
        move: { from: 'd2', to: 'd4' },
      });
      expect(await client.next((message) => message.type === 'error')).toMatchObject({
        requestId: 'too-fast',
        error: { code: 'ai_busy' },
      });

      // Resigning while the engine is thinking must abort the provider and
      // finish the game without a subsequent AI state.
      client.send({ type: 'resign', requestId: 'resign-thinking' });
      const resigned = await client.nextState(
        (state) => state.result?.reason === 'resignation',
      );
      expect(resigned.phase).toBe('finished');
      expect(resigned.result).toEqual({ winner: 'b', reason: 'resignation' });
      expect(resigned.ai?.thinking).toBe(false);
      expect(aborted).toBe(true);

      await delay(350);
      expect(client.queuedStates()).toHaveLength(0);
    } finally {
      client.close();
      await server.close();
    }
  });
});

describe('Static SPA serving', () => {
  it('serves index fallback, immutable assets and blocks traversal', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'chess-static-'));
    const root = path.join(base, 'web');
    await fs.mkdir(path.join(root, 'assets'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'index.html'),
      '<!doctype html><html><body><div id="root"></div></body></html>',
    );
    await fs.writeFile(
      path.join(root, 'assets', 'app-abc12345.js'),
      'console.log("nocturne");',
    );
    await fs.writeFile(path.join(base, 'secret.txt'), 'top secret');

    const server = await startServer({ staticDir: root });
    try {
      const index = await fetch(`${server.url}/`);
      expect(index.status).toBe(200);
      expect(index.headers.get('content-type')).toContain('text/html');
      expect(index.headers.get('cache-control')).toContain('no-cache');
      expect(index.headers.get('content-security-policy')).toContain(
        "frame-ancestors 'none'",
      );
      expect(await index.text()).toContain('id="root"');

      const asset = await fetch(`${server.url}/assets/app-abc12345.js`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get('content-type')).toContain('text/javascript');
      expect(asset.headers.get('cache-control')).toContain('immutable');

      const spaRoute = await fetch(`${server.url}/lobby/table/42`);
      expect(spaRoute.status).toBe(200);
      expect(await spaRoute.text()).toContain('id="root"');

      const missingAsset = await fetch(`${server.url}/assets/missing.js`);
      expect(missingAsset.status).toBe(404);
      const missingAssetRoute = await fetch(`${server.url}/assets/missing`);
      expect(missingAssetRoute.status).toBe(404);

      const traversal = await fetch(
        `${server.url}/assets/..%2f..%2fsecret.txt`,
      );
      expect(traversal.status).toBe(403);
      expect(await traversal.text()).not.toContain('top secret');

      // API routes keep precedence over static fallback.
      const health = await fetch(`${server.url}/api/health`);
      expect(health.status).toBe(200);
      expect((await health.json()) as { ok: boolean }).toMatchObject({ ok: true });
    } finally {
      await server.close();
      await fs.rm(base, { recursive: true, force: true });
    }
  });
});
