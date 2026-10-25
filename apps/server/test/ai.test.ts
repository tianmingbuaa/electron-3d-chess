import { describe, expect, it } from 'vitest';
import type {
  AiDifficulty,
  AiMoveChoice,
  AiMoveRequest,
  AiProvider,
  AiProviderInfo,
} from '@nocturne/chess-shared';
import {
  AI_DIFFICULTIES,
  AiProviderRegistry,
  createAiProviderRegistry,
} from '../src/ai/registry';
import {
  SIMPLE_AI_DEPTH_BY_DIFFICULTY,
  SIMPLE_AI_PROVIDER_NAME,
  SimpleAiProvider,
  createSimpleAiProvider,
} from '../src/ai/simple-provider';
import { ChessGame } from '../src/chess-game';

function requestFor(
  fen: string,
  difficulty: AiDifficulty,
  options: { signal?: AbortSignal; timeLimitMs?: number } = {},
): { game: ChessGame; request: AiMoveRequest } {
  const game = new ChessGame({ fen });
  const signal = options.signal ?? new AbortController().signal;
  return {
    game,
    request: {
      fen,
      color: game.turn,
      turn: game.turn,
      history: game.history,
      legalMoves: game.legalMoves,
      difficulty,
      timeLimitMs: options.timeLimitMs ?? 800,
      signal,
    },
  };
}

function choiceKey(choice: AiMoveChoice): string {
  return `${choice.from}${choice.to}${choice.promotion ?? ''}`;
}

function playChoice(game: ChessGame, choice: AiMoveChoice): void {
  game.applyMove({
    from: choice.from,
    to: choice.to,
    ...(choice.promotion === undefined ? {} : { promotion: choice.promotion }),
  });
}

const onlyEasyInfo: AiProviderInfo = {
  id: 'only-easy',
  name: 'Only Easy',
  description: 'Test provider with limited difficulty support.',
  version: '1.0.0',
  capabilities: {
    difficulties: ['easy'],
    supportsTimeLimit: false,
    supportsCancellation: false,
    remote: false,
  },
};

const onlyEasy: AiProvider = {
  info: onlyEasyInfo,
  async chooseMove(): Promise<AiMoveChoice | null> {
    return null;
  },
};

describe('AiProviderRegistry', () => {
  it('registers the built-in Simple Atelier Engine by default', () => {
    const registry = createAiProviderRegistry();
    const providers = registry.list();
    expect(providers.map((provider) => provider.id)).toContain('simple');
    const simple = providers.find((provider) => provider.id === 'simple');
    expect(simple?.name).toBe(SIMPLE_AI_PROVIDER_NAME);
    expect(simple?.capabilities.difficulties).toEqual([
      'easy',
      'normal',
      'hard',
    ]);
    expect(simple?.capabilities.remote).toBe(false);
    expect(registry.size).toBe(1);
    expect(registry.get('simple')).toBeInstanceOf(SimpleAiProvider);
  });

  it('merges extra providers and rejects duplicate IDs', () => {
    const registry = createAiProviderRegistry([onlyEasy]);
    expect(registry.list().map((provider) => provider.id)).toEqual([
      'simple',
      'only-easy',
    ]);
    expect(() => registry.register(onlyEasy)).toThrow(/already registered/i);
    expect(registry.supportsDifficulty('only-easy', 'easy')).toBe(true);
    expect(registry.supportsDifficulty('only-easy', 'normal')).toBe(false);
    expect(() => new AiProviderRegistry([onlyEasy, onlyEasy])).toThrow(
      /already registered/i,
    );

    expect(registry.unregister('only-easy')).toBe(true);
    expect(registry.unregister('only-easy')).toBe(false);
    expect(registry.get('only-easy')).toBeUndefined();
  });

  it('validates provider metadata at registration time', () => {
    const registry = new AiProviderRegistry();
    const invalid = {
      info: {
        ...onlyEasyInfo,
        capabilities: { ...onlyEasyInfo.capabilities, difficulties: [] },
      },
      chooseMove: async () => null,
    } as unknown as AiProvider;
    expect(() => registry.register(invalid)).toThrow(/at least one known difficulty/i);

    const malformed = {
      info: { ...onlyEasyInfo, id: '   ' },
      chooseMove: async () => null,
    } as AiProvider;
    expect(() => registry.register(malformed)).toThrow(/id must be a non-empty string/i);
  });

  it('supports every advertised difficulty through the built-in provider', () => {
    expect(AI_DIFFICULTIES).toEqual(['easy', 'normal', 'hard']);
    expect(SIMPLE_AI_DEPTH_BY_DIFFICULTY).toEqual({
      easy: 1,
      normal: 2,
      hard: 3,
    });
  });
});

describe('SimpleAiProvider', () => {
  it('returns a legal move for every difficulty', async () => {
    const provider = createSimpleAiProvider({ random: () => 0.5 });

    for (const difficulty of AI_DIFFICULTIES) {
      const { game, request } = requestFor(
        new ChessGame().fen,
        difficulty,
        { timeLimitMs: 1_500 },
      );
      const started = Date.now();
      const choice = await provider.chooseMove(request);
      const elapsed = Date.now() - started;

      expect(choice, difficulty).not.toBeNull();
      if (choice === null) continue;
      expect(
        request.legalMoves.map(choiceKey),
        `illegal ${difficulty} choice`,
      ).toContain(choiceKey(choice));
      expect(choice.depth).toBeLessThanOrEqual(
        SIMPLE_AI_DEPTH_BY_DIFFICULTY[difficulty],
      );
      expect(choice.nodes).toBeGreaterThan(0);
      expect(typeof choice.evaluationCp).toBe('number');

      expect(() => playChoice(game, choice)).not.toThrow();
      expect(game.history).toHaveLength(1);
      // Depth 3 on the initial position must remain responsive.
      expect(elapsed, `${difficulty} took ${elapsed}ms`).toBeLessThan(5_000);
    }
  });

  it('honors the time budget and still returns a legal move', async () => {
    const provider = createSimpleAiProvider({ random: () => 0 });
    const { request } = requestFor(new ChessGame().fen, 'hard', {
      timeLimitMs: 0,
    });
    const started = Date.now();
    const choice = await provider.chooseMove(request);
    const elapsed = Date.now() - started;

    expect(choice).not.toBeNull();
    if (choice === null) return;
    expect(
      request.legalMoves.map(choiceKey),
    ).toContain(choiceKey(choice));
    expect(elapsed).toBeLessThan(1_500);
  });

  it('rejects immediately when the AbortSignal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = createSimpleAiProvider();
    const { request } = requestFor(new ChessGame().fen, 'normal', {
      signal: controller.signal,
    });

    await expect(provider.chooseMove(request)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('finds an obvious mate in one on easy', async () => {
    const mateFen = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2';
    const provider = createSimpleAiProvider({ random: () => 0.5 });
    const { game, request } = requestFor(mateFen, 'easy', {
      timeLimitMs: 800,
    });

    const choice = await provider.chooseMove(request);
    expect(choice).not.toBeNull();
    if (choice === null) return;
    expect(choice.san).toBe('Qh4#');
    playChoice(game, choice);
    expect(game.result).toEqual({ winner: 'b', reason: 'checkmate' });
    expect(game.checkSquare).toBe('e1');
  });

  it('returns null when the side to move has no legal move', async () => {
    const game = new ChessGame();
    for (const [from, to] of [
      ['f2', 'f3'],
      ['e7', 'e5'],
      ['g2', 'g4'],
      ['d8', 'h4'],
    ] as const) {
      game.applyMove({ from, to });
    }
    expect(game.result?.reason).toBe('checkmate');
    const provider = createSimpleAiProvider();
    const request: AiMoveRequest = {
      fen: game.fen,
      color: game.turn,
      turn: game.turn,
      history: game.history,
      legalMoves: [],
      difficulty: 'normal',
      timeLimitMs: 500,
      signal: new AbortController().signal,
    };
    await expect(provider.chooseMove(request)).resolves.toBeNull();
  });
});
