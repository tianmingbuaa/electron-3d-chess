import {
  Chess,
  type Move as ChessMove,
  type Square as ChessSquare,
} from 'chess.js';
import {
  INITIAL_FEN,
  isPromotionPieceType,
  isSquare,
  oppositeColor,
  type CapturedPieceInfo,
  type CastlingInfo,
  type Color,
  type GamePhase,
  type GameResult,
  type LastMoveInfo,
  type LegalMove,
  type MoveInput,
  type MoveRecord,
  type PieceState,
  type PieceType,
  type PromotionPieceType,
  type Square,
} from '@nocturne/chess-shared';
import { ChessError } from './errors.js';
import { fileOf, makeSquare, rankOf } from './squares.js';

/**
 * Snapshot captured immediately before a move. Restoring it (together with
 * `chess.undo()`) makes repeated undo deterministic and, crucially, brings
 * captured pieces back with their original stable IDs.
 */
interface GameSnapshot {
  readonly pieces: Map<string, PieceState>;
  readonly lastMove: LastMoveInfo | null;
}

export interface ChessGameOptions {
  /**
   * Optional starting position. The WebSocket protocol always starts from the
   * initial position; this exists for direct engine use (tests, future
   * analysis tools and AI benchmarks).
   */
  fen?: string;
}

export interface ChessGameResignResult extends GameResult {
  reason: 'resignation';
}

/** Parse the full-move number out of a FEN string. */
function fullmoveFromFen(fen: string): number {
  const field = fen.split(' ')[5];
  const parsed = field === undefined ? Number.NaN : Number.parseInt(field, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function toMoveRecord(move: ChessMove, index: number): MoveRecord {
  const record: MoveRecord = {
    index,
    moveNumber: fullmoveFromFen(move.before),
    san: move.san,
    from: move.from as Square,
    to: move.to as Square,
    color: move.color as Color,
    piece: move.piece as PieceType,
  };
  if (move.captured !== undefined) {
    record.captured = move.captured as PieceType;
  }
  if (move.promotion !== undefined) {
    record.promotion = move.promotion as PromotionPieceType;
  }
  return record;
}

function clonePieces(source: Map<string, PieceState>): Map<string, PieceState> {
  const copy = new Map<string, PieceState>();
  for (const [id, piece] of source) {
    copy.set(id, { ...piece });
  }
  return copy;
}

/**
 * Authoritative chess rules engine with stable piece identity.
 *
 * Chess rules come from `chess.js`; this class adds the identity and
 * presentation model required by the wire protocol:
 *
 * - deterministic, stable piece IDs that survive moves, captures, promotions
 *   and undo;
 * - a `LastMoveInfo` rich enough to drive capture and castling animation;
 * - a snapshot stack used by undo;
 * - legal-move grouping and result/check metadata.
 *
 * The engine is deliberately transport- and AI-agnostic.
 */
export class ChessGame {
  private readonly chess: Chess;
  private readonly pieces = new Map<string, PieceState>();
  private readonly squareIndex = new Map<Square, string>();
  private readonly snapshots: GameSnapshot[] = [];
  private lastMoveValue: LastMoveInfo | null = null;
  private manualResult: GameResult | null = null;

  constructor(options: ChessGameOptions = {}) {
    const fen = options.fen ?? INITIAL_FEN;
    try {
      this.chess = new Chess(fen);
    } catch (error) {
      throw new ChessError(
        'bad_request',
        `Invalid FEN: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.allocatePieceIds();
  }

  /* ------------------------------------------------------------------ */
  /*                              Position                              */
  /* ------------------------------------------------------------------ */

  get fen(): string {
    return this.chess.fen();
  }

  get turn(): Color {
    return this.chess.turn() as Color;
  }

  get inCheck(): boolean {
    return this.chess.inCheck();
  }

  get checkSquare(): Square | null {
    if (!this.chess.inCheck()) return null;
    return this.findKingSquare(this.turn);
  }

  get phase(): GamePhase {
    return this.result === null ? 'playing' : 'finished';
  }

  get result(): GameResult | null {
    return this.manualResult ?? this.computeResult();
  }

  get moveNumber(): number {
    return this.chess.moveNumber();
  }

  /** Piece states in stable insertion order (cloned for safe external use). */
  get pieceStates(): PieceState[] {
    return Array.from(this.pieces.values(), (piece) => ({ ...piece }));
  }

  /** Full history, rebuilt from chess.js so undo can never desynchronise it. */
  get history(): MoveRecord[] {
    return this.chess
      .history({ verbose: true })
      .map((move, index) => toMoveRecord(move, index));
  }

  get lastMove(): LastMoveInfo | null {
    return this.lastMoveValue === null ? null : cloneLastMove(this.lastMoveValue);
  }

  /** All legal moves, promotion variants included. */
  get legalMoves(): LegalMove[] {
    if (this.phase === 'finished') return [];
    return this.chess.moves({ verbose: true }).map((move) => {
      const legal: LegalMove = {
        from: move.from as Square,
        to: move.to as Square,
        san: move.san,
      };
      if (move.promotion !== undefined) {
        legal.promotion = move.promotion as PromotionPieceType;
      }
      return legal;
    });
  }

  /** Legal destinations grouped by origin square for the side to move. */
  get legalMovesByOrigin(): Partial<Record<Square, Square[]>> {
    const grouped: Partial<Record<Square, Square[]>> = {};
    for (const move of this.legalMoves) {
      const existing = grouped[move.from];
      if (existing === undefined) {
        grouped[move.from] = [move.to];
      } else if (!existing.includes(move.to)) {
        existing.push(move.to);
      }
    }
    return grouped;
  }

  get snapshotDepth(): number {
    return this.snapshots.length;
  }

  /* ------------------------------------------------------------------ */
  /*                               Moves                                */
  /* ------------------------------------------------------------------ */

  /**
   * Apply a move, throwing `ChessError` with a protocol-friendly code when the
   * input is malformed, the position is finished or the move is not legal.
   */
  applyMove(input: MoveInput): LastMoveInfo {
    if (this.result !== null) {
      throw new ChessError('game_over', 'The game is already over.');
    }
    if (!isSquare(input.from) || !isSquare(input.to)) {
      throw new ChessError('invalid_move', 'Move squares must be valid algebraic squares.');
    }
    if (input.promotion !== undefined && !isPromotionPieceType(input.promotion)) {
      throw new ChessError('invalid_move', 'Promotion must be one of q, r, b or n.');
    }

    const candidates = this.chess
      .moves({ verbose: true })
      .filter(
        (move) =>
          move.from === input.from &&
          move.to === input.to &&
          (input.promotion === undefined
            ? move.promotion === undefined
            : move.promotion === input.promotion),
      );
    const selected = candidates[0];
    if (selected === undefined) {
      const isPromotionRoute = this.chess
        .moves({ verbose: true })
        .some(
          (move) =>
            move.from === input.from &&
            move.to === input.to &&
            move.promotion !== undefined,
        );
      if (input.promotion === undefined && isPromotionRoute) {
        throw new ChessError(
          'invalid_move',
          'A promotion piece (q, r, b or n) is required for this move.',
        );
      }
      throw new ChessError('illegal_move', `Illegal move ${input.from}${input.to}.`);
    }

    const fromPiece = this.pieceAt(input.from);
    if (fromPiece === undefined) {
      throw new ChessError(
        'internal_error',
        `No tracked piece exists on ${input.from}; the position is inconsistent.`,
      );
    }

    const isEnPassant = selected.isEnPassant();
    const capturedSquare: Square | undefined =
      selected.captured !== undefined
        ? isEnPassant
          ? makeSquare(fileOf(input.to), rankOf(input.from))
          : input.to
        : undefined;
    const capturedPiece =
      capturedSquare === undefined ? undefined : this.pieceAt(capturedSquare);
    if (selected.captured !== undefined && capturedPiece === undefined) {
      throw new ChessError(
        'internal_error',
        `Capture on ${capturedSquare ?? input.to} had no tracked piece.`,
      );
    }

    const isCastle = selected.isKingsideCastle() || selected.isQueensideCastle();
    let castling: CastlingInfo | undefined;
    if (isCastle) {
      const rank = rankOf(input.from);
      const kingSide = selected.isKingsideCastle();
      const rookFrom = makeSquare(kingSide ? 'h' : 'a', rank);
      const rookTo = makeSquare(kingSide ? 'f' : 'd', rank);
      const rook = this.pieceAt(rookFrom);
      if (rook === undefined) {
        throw new ChessError(
          'internal_error',
          `Castling rook was not tracked on ${rookFrom}.`,
        );
      }
      castling = {
        kingId: fromPiece.id,
        rookId: rook.id,
        rookFrom,
        rookTo,
      };
    }

    const historyIndex = this.chess.history().length;
    const snapshot: GameSnapshot = {
      pieces: clonePieces(this.pieces),
      lastMove: this.lastMoveValue,
    };
    this.snapshots.push(snapshot);

    let applied: ChessMove;
    try {
      applied = this.chess.move({
        from: input.from,
        to: input.to,
        ...(input.promotion === undefined ? {} : { promotion: input.promotion }),
      });
    } catch (error) {
      this.snapshots.pop();
      throw new ChessError(
        'internal_error',
        `chess.js rejected a validated move: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // Remove the captured piece before moving the surviving piece so the
    // square index can never point at two pieces.
    if (capturedPiece !== undefined && capturedSquare !== undefined) {
      this.pieces.delete(capturedPiece.id);
      this.squareIndex.delete(capturedSquare);
    }

    this.squareIndex.delete(input.from);
    const nextType: PieceType =
      selected.promotion === undefined
        ? fromPiece.type
        : (selected.promotion as PromotionPieceType);
    this.pieces.set(fromPiece.id, {
      id: fromPiece.id,
      type: nextType,
      color: fromPiece.color,
      square: input.to,
    });
    this.squareIndex.set(input.to, fromPiece.id);

    if (castling !== undefined) {
      const rook = this.pieces.get(castling.rookId);
      if (rook !== undefined) {
        this.squareIndex.delete(castling.rookFrom);
        this.pieces.set(rook.id, { ...rook, square: castling.rookTo });
        this.squareIndex.set(castling.rookTo, rook.id);
      }
    }

    const record = toMoveRecord(applied, historyIndex);
    const info: LastMoveInfo = {
      ...record,
      pieceId: fromPiece.id,
    };
    if (capturedPiece !== undefined && capturedSquare !== undefined) {
      info.capturedPiece = toCapturedInfo(capturedPiece, capturedSquare);
    }
    if (castling !== undefined) {
      info.castling = castling;
    }
    this.lastMoveValue = info;
    return cloneLastMove(info);
  }

  /**
   * Undo the most recent ply. Returns false when there is nothing to take back
   * or when the game was ended by resignation (resignation cannot be undone).
   */
  undo(): boolean {
    if (this.manualResult !== null) return false;
    const snapshot = this.snapshots.pop();
    if (snapshot === undefined) return false;
    const undone = this.chess.undo();
    if (undone === null) {
      this.snapshots.push(snapshot);
      return false;
    }
    this.restorePieces(snapshot.pieces);
    this.lastMoveValue = snapshot.lastMove;
    return true;
  }

  /**
   * Record a resignation for `resigner` (defaulting to the side to move);
   * winner is the opponent. Turn policy is enforced by the session layer,
   * because AI mode lets the human resign even while the engine is thinking.
   */
  resign(resigner: Color = this.turn): ChessGameResignResult {
    if (this.result !== null) {
      throw new ChessError('game_over', 'The game is already over.');
    }
    const result: ChessGameResignResult = {
      winner: oppositeColor(resigner),
      reason: 'resignation',
    };
    this.manualResult = result;
    return { ...result };
  }

  /* ------------------------------------------------------------------ */
  /*                             Internals                              */
  /* ------------------------------------------------------------------ */

  private allocatePieceIds(): void {
    const counters = new Map<string, number>();
    for (const color of ['w', 'b'] as const) {
      for (let rank = 1; rank <= 8; rank += 1) {
        for (let fileIndex = 0; fileIndex < 8; fileIndex += 1) {
          const file = String.fromCharCode(97 + fileIndex);
          if (!isSquare(`${file}${rank}`)) continue;
          const square = `${file}${rank}` as Square;
          const piece = this.chess.get(square as ChessSquare);
          if (piece === undefined || piece.color !== color) continue;
          const type = piece.type as PieceType;
          const key = `${color}-${type}`;
          const count = (counters.get(key) ?? 0) + 1;
          counters.set(key, count);
          const id = `${key}${count}`;
          this.pieces.set(id, { id, type, color, square });
          this.squareIndex.set(square, id);
        }
      }
    }
  }

  private restorePieces(source: Map<string, PieceState>): void {
    this.pieces.clear();
    this.squareIndex.clear();
    for (const [id, piece] of source) {
      this.pieces.set(id, { ...piece });
      this.squareIndex.set(piece.square, id);
    }
  }

  private pieceAt(square: Square): PieceState | undefined {
    const id = this.squareIndex.get(square);
    return id === undefined ? undefined : this.pieces.get(id);
  }

  private findKingSquare(color: Color): Square | null {
    for (const piece of this.pieces.values()) {
      if (piece.type === 'k' && piece.color === color) return piece.square;
    }
    return null;
  }

  private computeResult(): GameResult | null {
    if (this.chess.isCheckmate()) {
      return { winner: oppositeColor(this.turn), reason: 'checkmate' };
    }
    if (this.chess.isStalemate()) {
      return { winner: null, reason: 'stalemate' };
    }
    if (this.chess.isInsufficientMaterial()) {
      return { winner: null, reason: 'insufficient-material' };
    }
    if (this.chess.isThreefoldRepetition()) {
      return { winner: null, reason: 'threefold-repetition' };
    }
    if (this.chess.isDrawByFiftyMoves()) {
      return { winner: null, reason: 'fifty-move-rule' };
    }
    if (this.chess.isDraw()) {
      return { winner: null, reason: 'draw' };
    }
    return null;
  }
}

/** Deterministic piece-ID prefix documented in docs/PROTOCOL.md. */
export const PIECE_ID_FORMAT = '<color>-<pieceType><ordinal>' as const;

export { oppositeColor };

function toCapturedInfo(piece: PieceState, square: Square): CapturedPieceInfo {
  return {
    id: piece.id,
    type: piece.type,
    color: piece.color,
    square,
  };
}

function cloneLastMove(lastMove: LastMoveInfo): LastMoveInfo {
  const copy: LastMoveInfo = { ...lastMove };
  if (lastMove.capturedPiece !== undefined) {
    copy.capturedPiece = { ...lastMove.capturedPiece };
  }
  if (lastMove.castling !== undefined) {
    copy.castling = { ...lastMove.castling };
  }
  return copy;
}
