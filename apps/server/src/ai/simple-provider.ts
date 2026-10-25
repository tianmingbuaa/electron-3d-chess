import {
  Chess,
  type Move as ChessMove,
  type PieceSymbol,
} from 'chess.js';
import {
  type AiDifficulty,
  type AiMoveChoice,
  type AiMoveRequest,
  type AiProvider,
  type AiProviderInfo,
  type PromotionPieceType,
  type Square,
} from '@nocturne/chess-shared';

/** Depth searched by the placeholder engine for each difficulty. */
export const SIMPLE_AI_DEPTH_BY_DIFFICULTY: Readonly<Record<AiDifficulty, number>> =
  Object.freeze({
    easy: 1,
    normal: 2,
    hard: 3,
  });

/**
 * Soft per-difficulty time budgets used by GameSession. The provider also
 * enforces its own deadline, so a caller passing a shorter budget is honored.
 */
export const SIMPLE_AI_TIME_BUDGET_MS: Readonly<Record<AiDifficulty, number>> =
  Object.freeze({
    easy: 300,
    normal: 700,
    hard: 1_400,
  });

export const SIMPLE_AI_PROVIDER_ID = 'simple' as const;
export const SIMPLE_AI_PROVIDER_NAME = 'Simple Atelier Engine';
export const SIMPLE_AI_PROVIDER_VERSION = '1.0.0';

const INFO: AiProviderInfo = {
  id: SIMPLE_AI_PROVIDER_ID,
  name: SIMPLE_AI_PROVIDER_NAME,
  description:
    'Built-in placeholder engine: alpha-beta material search with piece-square scoring. Intended to be replaced by stronger providers.',
  version: SIMPLE_AI_PROVIDER_VERSION,
  author: 'Nocturne Atelier',
  capabilities: {
    difficulties: ['easy', 'normal', 'hard'],
    supportsTimeLimit: true,
    supportsCancellation: true,
    remote: false,
  },
};

export const SIMPLE_AI_PROVIDER_INFO: AiProviderInfo = INFO;
Object.freeze(INFO.capabilities.difficulties);
Object.freeze(INFO.capabilities);
Object.freeze(INFO);

export interface SimpleAiProviderOptions {
  /** Injectable RNG for deterministic tests; must return [0, 1). */
  random?: () => number;
}

const MATE_SCORE = 100_000;
const MAX_NODES = 250_000;
/** Never let a single provider call monopolize the server beyond this. */
const MAX_SEARCH_MS = 9_000;

const MATERIAL: Record<PieceSymbol, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0,
};

/**
 * Piece-square tables are written from White's point of view with index 0 at
 * a8 and index 63 at h1. Black reads the vertically mirrored index.
 */
const PAWN_TABLE: readonly number[] = [
  0, 0, 0, 0, 0, 0, 0, 0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
  5, 5, 10, 25, 25, 10, 5, 5,
  0, 0, 0, 20, 20, 0, 0, 0,
  5, -5, -10, 0, 0, -10, -5, 5,
  5, 10, 10, -20, -20, 10, 10, 5,
  0, 0, 0, 0, 0, 0, 0, 0,
];
const KNIGHT_TABLE: readonly number[] = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 0, 0, 0, -20, -40,
  -30, 0, 10, 15, 15, 10, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30,
  -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
];
const BISHOP_TABLE: readonly number[] = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 10, 10, 10, 10, 0, -10,
  -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 5, 0, 0, 0, 0, 5, -10,
  -20, -10, -10, -10, -10, -10, -10, -20,
];
const ROOK_TABLE: readonly number[] = [
  0, 0, 0, 0, 0, 0, 0, 0,
  5, 10, 10, 10, 10, 10, 10, 5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  0, 0, 0, 5, 5, 0, 0, 0,
];
const QUEEN_TABLE: readonly number[] = [
  -20, -10, -10, -5, -5, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 5, 5, 5, 0, -10,
  -5, 0, 5, 5, 5, 5, 0, -5,
  0, 0, 5, 5, 5, 5, 0, -5,
  -10, 5, 5, 5, 5, 5, 0, -10,
  -10, 0, 5, 0, 0, 0, 0, -10,
  -20, -10, -10, -5, -5, -10, -10, -20,
];
const KING_TABLE: readonly number[] = [
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20,
  20, 30, 10, 0, 0, 10, 30, 20,
];

const PIECE_SQUARE_TABLES: Record<PieceSymbol, readonly number[]> = {
  p: PAWN_TABLE,
  n: KNIGHT_TABLE,
  b: BISHOP_TABLE,
  r: ROOK_TABLE,
  q: QUEEN_TABLE,
  k: KING_TABLE,
};

class SearchBudgetExceeded extends Error {
  constructor() {
    super('Search budget exceeded.');
    this.name = 'SearchBudgetExceeded';
  }
}

function abortError(): DOMException {
  return new DOMException('AI search was aborted.', 'AbortError');
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

interface SearchContext {
  readonly signal: AbortSignal;
  readonly deadline: number;
  nodes: number;
}

interface ScoredMove {
  readonly move: ChessMove;
  readonly score: number;
}

/**
 * A deliberately modest but complete placeholder engine.
 *
 * - alpha-beta negamax with material + piece-square evaluation;
 * - depth 1 / 2 / 3 for easy / normal / hard;
 * - capture-first move ordering;
 * - iterative deepening so a tight deadline still yields a legal move;
 * - randomization among near-equal root moves;
 * - hard time and node limits, and AbortSignal cooperation.
 *
 * This is NOT a strong chess engine. It exists so the product has a legal,
 * responsive opponent before a real engine is integrated.
 */
export class SimpleAiProvider implements AiProvider {
  readonly info: AiProviderInfo = SIMPLE_AI_PROVIDER_INFO;
  private readonly random: () => number;

  constructor(options: SimpleAiProviderOptions = {}) {
    this.random = options.random ?? Math.random;
  }

  async chooseMove(request: AiMoveRequest): Promise<AiMoveChoice | null> {
    assertNotAborted(request.signal);
    const chess = new Chess(request.fen);
    if (chess.turn() !== request.color) {
      throw new Error(
        `AI request inconsistency: FEN turn is ${chess.turn()} but AI color is ${request.color}.`,
      );
    }

    const rootMoves = chess.moves({ verbose: true });
    if (rootMoves.length === 0) return null;

    const depth = SIMPLE_AI_DEPTH_BY_DIFFICULTY[request.difficulty];
    const budget = Number.isFinite(request.timeLimitMs)
      ? Math.max(0, Math.min(request.timeLimitMs, MAX_SEARCH_MS))
      : 0;
    const context: SearchContext = {
      signal: request.signal,
      deadline: Date.now() + budget,
      nodes: 0,
    };

    rootMoves.sort((a, b) => this.moveOrderScore(b) - this.moveOrderScore(a));

    let completed: ScoredMove[] | null = null;
    let completedDepth = 0;

    for (let currentDepth = 1; currentDepth <= depth; currentDepth += 1) {
      if (context.signal.aborted) throw abortError();
      if (Date.now() >= context.deadline) break;

      const scored: ScoredMove[] = [];
      let outOfTime = false;
      let alpha = -Infinity;

      for (const move of rootMoves) {
        assertNotAborted(context.signal);
        if (Date.now() >= context.deadline || context.nodes >= MAX_NODES) {
          outOfTime = true;
          break;
        }
        chess.move(move);
        let score: number;
        try {
          // Updating alpha at the root lets later siblings fail low, which is
          // where most of alpha-beta's pruning comes from in this engine.
          score = -this.negamax(
            chess,
            currentDepth - 1,
            -Infinity,
            -alpha,
            context,
            1,
          );
        } catch (error) {
          if (error instanceof SearchBudgetExceeded) {
            outOfTime = true;
            break;
          }
          throw error;
        } finally {
          chess.undo();
        }
        scored.push({ move, score });
        alpha = Math.max(alpha, score);
      }

      if (outOfTime) break;
      completed = scored;
      completedDepth = currentDepth;

      let best = -Infinity;
      for (const entry of scored) best = Math.max(best, entry.score);
      // A forced mate is already decisive; deeper search adds no value.
      if (best >= MATE_SCORE - 1_000) break;
    }

    const nodes = context.nodes;
    if (completed === null || completed.length === 0) {
      const fallback = this.pickRandom(rootMoves);
      return this.toChoice(fallback, 0, nodes, undefined);
    }

    let bestScore = -Infinity;
    for (const entry of completed) bestScore = Math.max(bestScore, entry.score);
    const mateFound = bestScore >= MATE_SCORE - 1_000;
    const tolerance = mateFound ? 0 : 15;
    const eligible = completed.filter((entry) => entry.score >= bestScore - tolerance);
    const picked = this.pickRandom(eligible);
    return this.toChoice(picked.move, completedDepth, nodes, picked.score);
  }

  private negamax(
    chess: Chess,
    depth: number,
    alpha: number,
    beta: number,
    context: SearchContext,
    ply: number,
  ): number {
    assertNotAborted(context.signal);
    if (Date.now() >= context.deadline || context.nodes >= MAX_NODES) {
      throw new SearchBudgetExceeded();
    }
    context.nodes += 1;

    if (chess.isCheckmate()) {
      return -(MATE_SCORE - ply);
    }
    if (chess.isDraw()) {
      return 0;
    }
    if (depth <= 0) {
      return this.evaluate(chess);
    }

    const moves = chess.moves({ verbose: true });
    moves.sort((a, b) => this.moveOrderScore(b) - this.moveOrderScore(a));

    let best = -Infinity;
    for (const move of moves) {
      assertNotAborted(context.signal);
      chess.move(move);
      let score: number;
      try {
        score = -this.negamax(chess, depth - 1, -beta, -alpha, context, ply + 1);
      } finally {
        chess.undo();
      }
      best = Math.max(best, score);
      alpha = Math.max(alpha, score);
      if (alpha >= beta) break;
    }
    return best;
  }

  /** Material + piece-square evaluation from the side to move's perspective. */
  private evaluate(chess: Chess): number {
    const board = chess.board();
    let whiteScore = 0;
    for (let row = 0; row < 8; row += 1) {
      const boardRow = board[row];
      if (boardRow === undefined) continue;
      for (let file = 0; file < 8; file += 1) {
        const piece = boardRow[file];
        if (piece === undefined || piece === null) continue;
        const table = PIECE_SQUARE_TABLES[piece.type];
        const index = piece.color === 'w' ? row * 8 + file : (7 - row) * 8 + file;
        const value = MATERIAL[piece.type] + (table[index] ?? 0);
        whiteScore += piece.color === 'w' ? value : -value;
      }
    }
    return chess.turn() === 'w' ? whiteScore : -whiteScore;
  }

  private moveOrderScore(move: ChessMove): number {
    let score = move.captured === undefined ? 0 : MATERIAL[move.captured] * 10;
    score -= MATERIAL[move.piece];
    if (move.promotion !== undefined) score += MATERIAL[move.promotion];
    if (move.isKingsideCastle() || move.isQueensideCastle()) score += 30;
    return score;
  }

  private pickRandom<T>(items: readonly T[]): T {
    const length = items.length;
    if (length === 0) throw new Error('Cannot pick a move from an empty list.');
    const raw = this.random();
    const normalized = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 0.999999) : 0;
    const index = Math.min(length - 1, Math.floor(normalized * length));
    const picked = items[index];
    if (picked === undefined) throw new Error('Random move selection failed.');
    return picked;
  }

  private toChoice(
    move: ChessMove,
    depth: number,
    nodes: number,
    evaluationCp: number | undefined,
  ): AiMoveChoice {
    const choice: AiMoveChoice = {
      from: move.from as Square,
      to: move.to as Square,
      san: move.san,
      depth,
      nodes,
    };
    if (move.promotion !== undefined) {
      choice.promotion = move.promotion as PromotionPieceType;
    }
    if (evaluationCp !== undefined) {
      choice.evaluationCp = Math.round(evaluationCp);
    }
    return choice;
  }
}

/** Factory used by the registry; allows injecting a deterministic RNG. */
export function createSimpleAiProvider(
  options: SimpleAiProviderOptions = {},
): SimpleAiProvider {
  return new SimpleAiProvider(options);
}

/** Convenience alias for consumers that refer to the built-in engine by id. */
export type BuiltinAiProvider = SimpleAiProvider;
