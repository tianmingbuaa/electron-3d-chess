import { randomUUID } from 'node:crypto';
import {
  DEFAULT_AI_CONFIG,
  isPromotionPieceType,
  oppositeColor,
  type AiConfig,
  type AiDifficulty,
  type AiMoveChoice,
  type AiMoveRequest,
  type AiProvider,
  type ClientMessage,
  type Color,
  type GameMode,
  type GameState,
  type MoveInput,
  type NewGameConfig,
  type ProtocolError,
  type ProtocolErrorCode,
  type ServerInfo,
  type ServerMessage,
} from '@nocturne/chess-shared';
import { AiProviderRegistry, isAiDifficulty } from './ai/registry.js';
import { ChessGame } from './chess-game.js';
import { isChessError } from './errors.js';
import { safeLog, type LogFn } from './logging.js';
import {
  DEFAULT_AI_MOVE_DELAY_MS,
  DEFAULT_AI_PROVIDER_ID,
  DEFAULT_AI_TIMEOUT_MS,
  SERVER_VERSION,
  createServerInfo,
} from './protocol.js';
import { SIMPLE_AI_TIME_BUDGET_MS } from './ai/simple-provider.js';

interface ActiveGameConfig {
  readonly mode: GameMode;
  readonly humanColor: Color | null;
  readonly ai: AiConfig | null;
  readonly providerName: string | null;
}

type ResolveConfigResult =
  | { ok: true; config: ActiveGameConfig }
  | { ok: false; message: string };

export interface GameSessionOptions {
  registry: AiProviderRegistry;
  emit: (message: ServerMessage) => void;
  sessionId?: string;
  serverVersion?: string;
  defaultAiProviderId?: string;
  aiMoveDelayMs?: number;
  aiTimeoutMs?: number;
  log?: LogFn;
}

/**
 * Owns one connected client's authoritative game.
 *
 * The session is transport-independent: it emits wire `ServerMessage` values
 * through a callback and never touches sockets. It serialises revisions, turn
 * ownership, undo policy and the complete AI lifecycle.
 */
export class GameSession {
  readonly sessionId: string;

  private readonly registry: AiProviderRegistry;
  private readonly emitMessage: (message: ServerMessage) => void;
  private readonly serverVersion: string;
  private readonly defaultAiProviderId: string;
  private readonly aiMoveDelayMs: number;
  private readonly aiTimeoutMs: number;
  private readonly log: LogFn | undefined;

  private config: ActiveGameConfig;
  private game: ChessGame;
  private revision = 0;
  private disposed = false;

  private aiThinking = false;
  private aiController: AbortController | null = null;
  private aiGeneration = 0;

  constructor(options: GameSessionOptions) {
    this.registry = options.registry;
    this.emitMessage = options.emit;
    this.sessionId = options.sessionId ?? randomUUID();
    this.serverVersion = options.serverVersion ?? SERVER_VERSION;
    this.defaultAiProviderId = options.defaultAiProviderId ?? DEFAULT_AI_PROVIDER_ID;
    this.aiMoveDelayMs =
      options.aiMoveDelayMs !== undefined &&
      Number.isFinite(options.aiMoveDelayMs) &&
      options.aiMoveDelayMs >= 0
        ? options.aiMoveDelayMs
        : DEFAULT_AI_MOVE_DELAY_MS;
    this.aiTimeoutMs =
      options.aiTimeoutMs !== undefined &&
      Number.isFinite(options.aiTimeoutMs) &&
      options.aiTimeoutMs > 0
        ? options.aiTimeoutMs
        : DEFAULT_AI_TIMEOUT_MS;
    this.log = options.log;
    this.config = {
      mode: 'local',
      humanColor: null,
      ai: null,
      providerName: null,
    };
    this.game = new ChessGame();
  }

  /* ------------------------------------------------------------------ */
  /*                           Connection entry                         */
  /* ------------------------------------------------------------------ */

  sendWelcome(): void {
    this.emit({
      type: 'welcome',
      info: this.serverInfo(),
      state: this.buildState(),
    });
  }

  getState(): GameState {
    return this.buildState();
  }

  handleMessage(message: ClientMessage): void {
    switch (message.type) {
      case 'new_game':
        this.newGame(message.config, message.requestId);
        return;
      case 'move':
        this.move(message.move, message.requestId);
        return;
      case 'undo':
        this.undo(message.requestId);
        return;
      case 'restart':
        this.restart(message.requestId);
        return;
      case 'resign':
        this.resign(message.requestId);
        return;
      case 'ping':
        this.emit({ type: 'pong', ...(message.requestId === undefined ? {} : { requestId: message.requestId }) });
        return;
    }
  }

  /** Abort any in-flight AI work and stop emitting messages. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAi();
  }

  /* ------------------------------------------------------------------ */
  /*                              Commands                              */
  /* ------------------------------------------------------------------ */

  newGame(config: NewGameConfig, requestId?: string): void {
    const resolved = this.resolveConfig(config);
    if (!resolved.ok) {
      this.emitError('bad_request', resolved.message, requestId);
      return;
    }

    this.cancelAi();
    this.config = resolved.config;
    this.game = new ChessGame();
    this.bumpRevision();

    if (this.shouldAiMove()) {
      this.startAi(requestId);
    } else {
      this.emitState(requestId);
    }
  }

  restart(requestId?: string): void {
    this.cancelAi();
    this.game = new ChessGame();
    this.bumpRevision();

    if (this.shouldAiMove()) {
      this.startAi(requestId);
    } else {
      this.emitState(requestId);
    }
  }

  move(input: MoveInput, requestId?: string): void {
    if (this.game.result !== null) {
      this.emitError('game_over', 'The game is already over.', requestId);
      return;
    }
    if (this.config.mode === 'ai') {
      if (this.aiThinking) {
        this.emitError('ai_busy', 'The AI is thinking; wait for its move.', requestId);
        return;
      }
      const humanColor = this.config.humanColor;
      if (humanColor !== null && this.game.turn !== humanColor) {
        this.emitError('not_your_turn', `It is ${this.game.turn}'s turn, not yours.`, requestId);
        return;
      }
    }

    try {
      this.game.applyMove(input);
    } catch (error) {
      if (isChessError(error)) {
        this.emitError(error.code, error.message, requestId);
      } else {
        this.reportUnexpected(error, requestId);
      }
      return;
    }

    this.bumpRevision();
    if (this.shouldAiMove()) {
      this.startAi(requestId);
    } else {
      this.emitState(requestId);
    }
  }

  undo(requestId?: string): void {
    if (this.game.result !== null) {
      this.emitError('game_over', 'The game is already over.', requestId);
      return;
    }
    if (this.aiThinking) {
      this.emitError('ai_busy', 'Undo is disabled while the AI is thinking.', requestId);
      return;
    }

    const historyLength = this.game.history.length;
    let plies = 1;

    if (this.config.mode === 'ai') {
      const humanColor = this.config.humanColor;
      if (humanColor === null) {
        this.emitError('bad_request', 'Undo is unavailable for this game.', requestId);
        return;
      }
      const aiColor = oppositeColor(humanColor);
      plies = this.game.turn === aiColor ? 1 : 2;
      const remaining = historyLength - plies;
      if (
        remaining < 0 ||
        (remaining % 2 === 0 ? 'w' : 'b') !== humanColor
      ) {
        this.emitError('bad_request', 'There is nothing to undo.', requestId);
        return;
      }
    } else if (historyLength === 0) {
      this.emitError('bad_request', 'There is nothing to undo.', requestId);
      return;
    }

    // Defensive: undo must never race with an active provider call.
    this.cancelAi();

    let undone = 0;
    for (let index = 0; index < plies; index += 1) {
      if (!this.game.undo()) break;
      undone += 1;
    }
    if (undone !== plies) {
      this.reportUnexpected(
        new Error(`Undo expected ${plies} plies but restored ${undone}.`),
        requestId,
      );
      return;
    }

    this.bumpRevision();
    this.emitState(requestId);
  }

  resign(requestId?: string): void {
    if (this.game.result !== null) {
      this.emitError('game_over', 'The game is already over.', requestId);
      return;
    }
    const humanColor = this.config.humanColor;
    if (this.config.mode === 'ai' && humanColor === null) {
      this.emitError('bad_request', 'Resignation is unavailable for this game.', requestId);
      return;
    }

    // In AI mode the human may resign at any time, including while the engine
    // is thinking; aborting the search prevents a post-resignation AI move.
    this.cancelAi();
    try {
      this.game.resign(this.config.mode === 'ai' && humanColor !== null ? humanColor : this.game.turn);
    } catch (error) {
      if (isChessError(error)) {
        this.emitError(error.code, error.message, requestId);
      } else {
        this.reportUnexpected(error, requestId);
      }
      return;
    }
    this.bumpRevision();
    this.emitState(requestId);
  }

  /* ------------------------------------------------------------------ */
  /*                                 AI                                 */
  /* ------------------------------------------------------------------ */

  private shouldAiMove(): boolean {
    if (this.config.mode !== 'ai' || this.config.humanColor === null) return false;
    if (this.game.result !== null) return false;
    return this.game.turn === oppositeColor(this.config.humanColor);
  }

  private startAi(requestId?: string): void {
    if (!this.shouldAiMove() || this.config.ai === null || this.config.humanColor === null) {
      return;
    }
    if (this.aiThinking) {
      // A caller should have cancelled first; doing it here keeps at most one
      // provider task alive regardless.
      this.cancelAi();
    }

    const provider = this.registry.get(this.config.ai.providerId);
    if (provider === undefined) {
      this.emitError(
        'internal_error',
        `AI provider "${this.config.ai.providerId}" is no longer registered.`,
        requestId,
      );
      this.emitState();
      return;
    }

    const aiColor = oppositeColor(this.config.humanColor);
    const controller = new AbortController();
    const request: AiMoveRequest = {
      fen: this.game.fen,
      color: aiColor,
      turn: this.game.turn,
      history: this.game.history,
      legalMoves: this.game.legalMoves,
      difficulty: this.config.ai.difficulty,
      timeLimitMs: this.timeBudgetFor(this.config.ai.difficulty),
      signal: controller.signal,
    };

    this.aiThinking = true;
    const generation = ++this.aiGeneration;
    this.aiController = controller;

    // Thinking state goes out before the provider is invoked so the renderer
    // can animate immediately, even for synchronous providers.
    this.emitState(requestId);
    void this.runAi(generation, controller, provider, request);
  }

  private async runAi(
    generation: number,
    controller: AbortController,
    provider: AiProvider,
    request: AiMoveRequest,
  ): Promise<void> {
    const startedAt = Date.now();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error('AI provider timed out.'));
      }, this.aiTimeoutMs);
      timer.unref();
    });

    const abortPromise = new Promise<never>((_resolve, reject) => {
      if (controller.signal.aborted) {
        reject(abortError());
        return;
      }
      controller.signal.addEventListener(
        'abort',
        () => reject(abortError()),
        { once: true },
      );
    });

    const minimumDelay = waitUntil(startedAt + this.aiMoveDelayMs, controller.signal);

    try {
      const choice = await Promise.race([
        provider.chooseMove(request),
        timeoutPromise,
        abortPromise,
      ]);
      if (!this.isCurrentAi(generation)) return;
      await minimumDelay;
      if (!this.isCurrentAi(generation)) return;

      if (choice === null) {
        throw new Error('The AI provider returned no move.');
      }
      this.validateProviderChoice(choice);

      if (this.game.fen !== request.fen) {
        throw new Error('The position changed while the AI was thinking.');
      }

      this.game.applyMove({
        from: choice.from,
        to: choice.to,
        ...(choice.promotion === undefined ? {} : { promotion: choice.promotion }),
      });

      this.aiThinking = false;
      this.aiController = null;
      this.bumpRevision();
      this.emitState();
    } catch (error) {
      if (!this.isCurrentAi(generation)) return;
      this.aiThinking = false;
      this.aiController = null;

      const providerName = this.config.providerName ?? provider.info.name;
      const message = timedOut
        ? `AI provider "${providerName}" timed out after ${this.aiTimeoutMs} ms.`
        : `AI provider "${providerName}" failed: ${describeError(error)}`;

      safeLog(this.log, 'warn', message, error);
      this.emitState(
        undefined,
        'AI provider failed; undo or start a new game.',
      );
      this.emitError('internal_error', message);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private validateProviderChoice(choice: AiMoveChoice): void {
    if (
      typeof choice.from !== 'string' ||
      typeof choice.to !== 'string' ||
      (choice.promotion !== undefined && !isPromotionPieceType(choice.promotion))
    ) {
      throw new Error('AI provider returned a malformed move.');
    }
    // Full legality (including squares) is enforced by ChessGame.applyMove.
  }

  private isCurrentAi(generation: number): boolean {
    return !this.disposed && generation === this.aiGeneration;
  }

  private cancelAi(): void {
    this.aiGeneration += 1;
    const controller = this.aiController;
    this.aiController = null;
    this.aiThinking = false;
    controller?.abort();
  }

  private timeBudgetFor(difficulty: AiDifficulty): number {
    return SIMPLE_AI_TIME_BUDGET_MS[difficulty];
  }

  /* ------------------------------------------------------------------ */
  /*                          State / protocol                          */
  /* ------------------------------------------------------------------ */

  private buildState(): GameState {
    const aiStatus =
      this.config.mode === 'ai' &&
      this.config.humanColor !== null &&
      this.config.ai !== null
        ? {
            color: oppositeColor(this.config.humanColor),
            providerId: this.config.ai.providerId,
            providerName: this.config.providerName ?? this.config.ai.providerId,
            difficulty: this.config.ai.difficulty,
            thinking: this.aiThinking,
          }
        : null;

    return {
      sessionId: this.sessionId,
      revision: this.revision,
      fen: this.game.fen,
      mode: this.config.mode,
      humanColor: this.config.humanColor,
      ai: aiStatus,
      pieces: this.game.pieceStates,
      turn: this.game.turn,
      phase: this.game.phase,
      inCheck: this.game.inCheck,
      checkSquare: this.game.checkSquare,
      result: this.game.result,
      legalMoves: this.game.legalMovesByOrigin,
      history: this.game.history,
      lastMove: this.game.lastMove,
      canUndo: this.computeCanUndo(),
      moveNumber: this.game.moveNumber,
    };
  }

  private computeCanUndo(): boolean {
    if (this.aiThinking || this.game.result !== null) return false;
    const historyLength = this.game.history.length;

    if (this.config.mode === 'local') {
      return historyLength > 0;
    }

    const humanColor = this.config.humanColor;
    if (humanColor === null) return false;
    const plies = this.game.turn === oppositeColor(humanColor) ? 1 : 2;
    const remaining = historyLength - plies;
    return remaining >= 0 && (remaining % 2 === 0 ? 'w' : 'b') === humanColor;
  }

  private serverInfo(): ServerInfo {
    return createServerInfo({
      version: this.serverVersion,
      providers: this.registry.list(),
    });
  }

  private emitState(requestId?: string, notice?: string): void {
    if (this.disposed) return;
    this.emit({
      type: 'state',
      state: this.buildState(),
      ...(requestId === undefined ? {} : { requestId }),
      ...(notice === undefined ? {} : { notice }),
    });
  }

  private emitError(
    code: ProtocolErrorCode,
    message: string,
    requestId?: string,
  ): void {
    if (this.disposed) return;
    const error: ProtocolError = { code, message };
    this.emit({
      type: 'error',
      error,
      ...(requestId === undefined ? {} : { requestId }),
    });
  }

  private reportUnexpected(error: unknown, requestId?: string): void {
    const message = `Unexpected server error: ${describeError(error)}`;
    safeLog(this.log, 'error', message, error);
    this.emitError('internal_error', message, requestId);
  }

  private emit(message: ServerMessage): void {
    if (this.disposed) return;
    this.emitMessage(message);
  }

  private bumpRevision(): void {
    this.revision += 1;
  }

  private resolveConfig(config: NewGameConfig): ResolveConfigResult {
    if (config.mode === 'local') {
      return {
        ok: true,
        config: {
          mode: 'local',
          humanColor: null,
          ai: null,
          providerName: null,
        },
      };
    }

    const humanColor: Color = config.humanColor ?? 'w';
    const requestedAi: AiConfig =
      config.ai ?? {
        providerId: this.defaultAiProviderId,
        difficulty: DEFAULT_AI_CONFIG.difficulty,
      };
    if (typeof requestedAi.providerId !== 'string' || requestedAi.providerId.trim() === '') {
      return { ok: false, message: 'AI providerId must be a non-empty string.' };
    }
    if (!isAiDifficulty(requestedAi.difficulty)) {
      return {
        ok: false,
        message: `AI difficulty must be one of easy, normal or hard.`,
      };
    }

    const provider = this.registry.get(requestedAi.providerId);
    if (provider === undefined) {
      return {
        ok: false,
        message: `Unknown AI provider "${requestedAi.providerId}".`,
      };
    }
    if (!this.registry.supportsDifficulty(requestedAi.providerId, requestedAi.difficulty)) {
      return {
        ok: false,
        message: `AI provider "${requestedAi.providerId}" does not support difficulty "${requestedAi.difficulty}".`,
      };
    }

    return {
      ok: true,
      config: {
        mode: 'ai',
        humanColor,
        ai: {
          providerId: requestedAi.providerId,
          difficulty: requestedAi.difficulty,
        },
        providerName: provider.info.name,
      },
    };
  }
}

/* ---------------------------------------------------------------------- */
/*                              Helpers                                   */
/* ---------------------------------------------------------------------- */

function abortError(): Error {
  const error = new Error('AI task was aborted.');
  error.name = 'AbortError';
  return error;
}

function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.length > 300 ? `${raw.slice(0, 297)}...` : raw;
}

/** Resolve after `deadline`, or immediately when the signal aborts. */
function waitUntil(deadline: number, signal: AbortSignal): Promise<void> {
  const remaining = deadline - Date.now();
  if (remaining <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    timer = setTimeout(finish, remaining);
    timer.unref();
    signal.addEventListener('abort', finish, { once: true });
  });
}

