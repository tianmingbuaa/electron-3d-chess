import { describe, expect, it } from 'vitest';
import type { GameResult, Square } from '@nocturne/chess-shared';
import { ChessGame } from '../src/chess-game';
import { ChessError } from '../src/errors';

function applyUci(game: ChessGame, uci: string): void {
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const promotion = uci.length > 4 ? uci.slice(4) : undefined;
  game.applyMove({
    from,
    to,
    ...(promotion === undefined
      ? {}
      : { promotion: promotion as 'q' | 'r' | 'b' | 'n' }),
  });
}

function pieceById(game: ChessGame, id: string) {
  return game.pieceStates.find((piece) => piece.id === id);
}

function pieceAt(game: ChessGame, square: Square) {
  return game.pieceStates.find((piece) => piece.square === square);
}

function expectChessError(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error('Expected ChessError to be thrown.');
  } catch (error) {
    expect(error).toBeInstanceOf(ChessError);
    expect((error as ChessError).code).toBe(code);
  }
}

describe('ChessGame initial position', () => {
  it('allocates 32 unique deterministic piece IDs', () => {
    const game = new ChessGame();
    const pieces = game.pieceStates;
    expect(pieces).toHaveLength(32);
    expect(new Set(pieces.map((piece) => piece.id)).size).toBe(32);

    // IDs never encode the square, so they remain stable after a move.
    expect(pieceById(game, 'w-k1')).toMatchObject({
      type: 'k',
      color: 'w',
      square: 'e1',
    });
    expect(pieceById(game, 'w-p1')).toMatchObject({ type: 'p', square: 'a2' });
    expect(pieceById(game, 'b-p1')).toMatchObject({ type: 'p', square: 'a7' });
    expect(pieceById(game, 'b-k1')).toMatchObject({ type: 'k', square: 'e8' });
    expect(game.lastMove).toBeNull();
    expect(game.history).toEqual([]);
    expect(game.phase).toBe('playing');
    expect(game.turn).toBe('w');
  });

  it('exposes legal destinations grouped by origin', () => {
    const game = new ChessGame();
    const moves = game.legalMovesByOrigin;
    expect(moves.e2).toEqual(['e3', 'e4']);
    expect(moves.b1).toEqual(['a3', 'c3']);
    expect(moves.e5).toBeUndefined();
    expect(game.legalMoves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'e2', to: 'e4', san: 'e4' }),
        expect.objectContaining({ from: 'g1', to: 'f3', san: 'Nf3' }),
      ]),
    );
  });
});

describe('ChessGame moves, history and undo', () => {
  it('applies a basic move and records SAN, IDs, turn and full-move number', () => {
    const game = new ChessGame();
    const lastMove = game.applyMove({ from: 'e2', to: 'e4' });

    expect(lastMove).toMatchObject({
      index: 0,
      moveNumber: 1,
      san: 'e4',
      from: 'e2',
      to: 'e4',
      color: 'w',
      piece: 'p',
      pieceId: 'w-p5',
    });
    expect(lastMove.capturedPiece).toBeUndefined();
    expect(lastMove.castling).toBeUndefined();
    expect(game.turn).toBe('b');
    expect(game.history).toHaveLength(1);
    expect(game.history[0]).toMatchObject({ san: 'e4' });
    expect(game.history[0]?.captured).toBeUndefined();
    expect(pieceById(game, 'w-p5')?.square).toBe('e4');
    expect(game.fen).toContain('4P3');
  });

  it('removes captured pieces and restores them with the same ID on undo', () => {
    const game = new ChessGame();
    applyUci(game, 'e2e4');
    applyUci(game, 'd7d5');
    const capture = game.applyMove({ from: 'e4', to: 'd5' });

    expect(capture.captured).toBe('p');
    expect(capture.capturedPiece).toMatchObject({
      id: 'b-p4',
      type: 'p',
      color: 'b',
      square: 'd5',
    });
    expect(game.history.at(-1)).toMatchObject({
      index: 2,
      san: 'exd5',
      captured: 'p',
    });
    expect(game.pieceStates).toHaveLength(31);
    expect(pieceById(game, 'b-p4')).toBeUndefined();
    expect(pieceById(game, 'w-p5')?.square).toBe('d5');

    expect(game.undo()).toBe(true);
    expect(game.pieceStates).toHaveLength(32);
    expect(pieceById(game, 'b-p4')).toMatchObject({ type: 'p', square: 'd5' });
    expect(pieceById(game, 'w-p5')?.square).toBe('e4');
    expect(game.turn).toBe('w');
    expect(game.history).toHaveLength(2);
    expect(game.lastMove).toMatchObject({ san: 'd5', from: 'd7', to: 'd5' });
  });

  it('supports en passant and reports the captured pawn square', () => {
    const game = new ChessGame();
    applyUci(game, 'e2e4');
    applyUci(game, 'a7a6');
    applyUci(game, 'e4e5');
    applyUci(game, 'd7d5');
    const enPassant = game.applyMove({ from: 'e5', to: 'd6' });

    expect(enPassant.captured).toBe('p');
    expect(enPassant.capturedPiece).toMatchObject({
      id: 'b-p4',
      color: 'b',
      square: 'd5',
    });
    expect(game.pieceStates).toHaveLength(31);
    expect(pieceAt(game, 'd5')).toBeUndefined();
    expect(pieceAt(game, 'd6')).toMatchObject({
      id: enPassant.pieceId,
      type: 'p',
      color: 'w',
    });
    expect(game.history.at(-1)).toMatchObject({
      from: 'e5',
      to: 'd6',
      captured: 'p',
    });

    expect(game.undo()).toBe(true);
    expect(game.pieceStates).toHaveLength(32);
    expect(pieceById(game, 'b-p4')?.square).toBe('d5');
    expect(pieceAt(game, 'd6')).toBeUndefined();
    expect(pieceAt(game, 'e5')?.id).toBe('w-p5');
    expect(game.turn).toBe('w');
  });

  it('supports kingside castling and exposes king/rook IDs', () => {
    const game = new ChessGame();
    for (const uci of ['e2e4', 'a7a6', 'g1f3', 'a6a5', 'f1c4', 'a5a4']) {
      applyUci(game, uci);
    }
    const castle = game.applyMove({ from: 'e1', to: 'g1' });

    expect(castle.san).toBe('O-O');
    expect(castle.castling).toEqual({
      kingId: 'w-k1',
      rookId: 'w-r2',
      rookFrom: 'h1',
      rookTo: 'f1',
    });
    expect(pieceById(game, 'w-k1')?.square).toBe('g1');
    expect(pieceById(game, 'w-r2')?.square).toBe('f1');
    expect(pieceAt(game, 'h1')).toBeUndefined();
    expect(game.history).toHaveLength(7);

    expect(game.undo()).toBe(true);
    expect(pieceById(game, 'w-k1')?.square).toBe('e1');
    expect(pieceById(game, 'w-r2')?.square).toBe('h1');
    expect(game.lastMove).toMatchObject({ from: 'a5', to: 'a4' });
  });

  it('supports queenside castling', () => {
    const game = new ChessGame();
    for (const uci of [
      'd2d4',
      'a7a6',
      'b1c3',
      'a6a5',
      'c1e3',
      'a5a4',
      'd1d2',
      'a4a3',
    ]) {
      applyUci(game, uci);
    }
    const castle = game.applyMove({ from: 'e1', to: 'c1' });

    expect(castle.san).toBe('O-O-O');
    expect(castle.castling).toEqual({
      kingId: 'w-k1',
      rookId: 'w-r1',
      rookFrom: 'a1',
      rookTo: 'd1',
    });
    expect(pieceById(game, 'w-k1')?.square).toBe('c1');
    expect(pieceById(game, 'w-r1')?.square).toBe('d1');
    expect(pieceAt(game, 'a1')).toBeUndefined();
  });

  it('keeps the pawn ID stable through promotion and restores it on undo', () => {
    const game = new ChessGame({
      fen: '7k/P7/8/8/8/8/8/7K w - - 0 1',
    });
    const pawnId = pieceAt(game, 'a7')?.id;
    expect(pawnId).toBeDefined();

    const promotion = game.applyMove({ from: 'a7', to: 'a8', promotion: 'q' });
    expect(promotion.promotion).toBe('q');
    expect(promotion.piece).toBe('p');
    expect(pieceById(game, pawnId as string)).toMatchObject({
      type: 'q',
      color: 'w',
      square: 'a8',
    });
    expect(game.history.at(-1)).toMatchObject({
      san: 'a8=Q+',
      promotion: 'q',
      piece: 'p',
    });

    expect(game.undo()).toBe(true);
    expect(pieceById(game, pawnId as string)).toMatchObject({
      type: 'p',
      square: 'a7',
    });
    expect(game.history).toHaveLength(0);
  });

  it('requires an explicit promotion piece for a promotion move', () => {
    const game = new ChessGame({ fen: '7k/P7/8/8/8/8/8/7K w - - 0 1' });
    expectChessError(() => game.applyMove({ from: 'a7', to: 'a8' }), 'invalid_move');
    expect(game.history).toHaveLength(0);
    expect(pieceAt(game, 'a7')?.type).toBe('p');
  });

  it('rejects illegal and malformed moves without mutating the game', () => {
    const game = new ChessGame();
    expectChessError(() => game.applyMove({ from: 'e2', to: 'e5' }), 'illegal_move');
    expectChessError(
      () => game.applyMove({ from: 'z9' as Square, to: 'e4' }),
      'invalid_move',
    );
    expect(game.history).toEqual([]);
    expect(game.fen).toBe(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    );
    expect(game.undo()).toBe(false);
  });
});

describe('ChessGame checks, results and resignation', () => {
  it('detects check and reports the checked king square', () => {
    const game = new ChessGame({ fen: '4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1' });
    game.applyMove({ from: 'a1', to: 'a8' });

    expect(game.inCheck).toBe(true);
    expect(game.checkSquare).toBe('e8');
    expect(game.result).toBeNull();
    expect(game.turn).toBe('b');
    expect(game.legalMovesByOrigin.e8).toBeDefined();
  });

  it("detects fool's mate, empties legal moves and rejects further commands", () => {
    const game = new ChessGame();
    applyUci(game, 'f2f3');
    applyUci(game, 'e7e5');
    applyUci(game, 'g2g4');
    const mate = game.applyMove({ from: 'd8', to: 'h4' });

    expect(mate.san).toBe('Qh4#');
    expect(game.result).toEqual({
      winner: 'b',
      reason: 'checkmate',
    } satisfies GameResult);
    expect(game.phase).toBe('finished');
    expect(game.inCheck).toBe(true);
    expect(game.checkSquare).toBe('e1');
    expect(game.legalMoves).toEqual([]);
    expect(game.legalMovesByOrigin).toEqual({});
    expect(game.history.at(-1)).toMatchObject({
      index: 3,
      color: 'b',
      piece: 'q',
      san: 'Qh4#',
    });

    expectChessError(() => game.applyMove({ from: 'd2', to: 'd4' }), 'game_over');
    expectChessError(() => game.resign(), 'game_over');
  });

  it('lets the side to move resign; opponent wins and no undo is possible', () => {
    const game = new ChessGame();
    applyUci(game, 'e2e4');

    const result = game.resign();
    expect(result).toEqual({ winner: 'w', reason: 'resignation' });
    expect(game.phase).toBe('finished');
    expect(game.legalMoves).toEqual([]);
    expect(game.undo()).toBe(false);
    expectChessError(() => game.applyMove({ from: 'e7', to: 'e5' }), 'game_over');
    expectChessError(() => game.resign(), 'game_over');
  });

  it('reports insufficient-material and fifty-move draws', () => {
    const bareKings = new ChessGame({ fen: '8/8/8/8/8/8/8/K6k w - - 0 1' });
    expect(bareKings.result).toEqual({
      winner: null,
      reason: 'insufficient-material',
    });
    expect(bareKings.phase).toBe('finished');

    const fifty = new ChessGame({ fen: '7k/8/8/8/8/8/8/K5R1 w - - 99 60' });
    expect(fifty.moveNumber).toBe(60);
    fifty.applyMove({ from: 'g1', to: 'g2' });
    expect(fifty.result).toEqual({ winner: null, reason: 'fifty-move-rule' });
    expect(fifty.history[0]).toMatchObject({ moveNumber: 60, san: 'Rg2' });
  });

  it('reports threefold repetition after repeated knight moves', () => {
    const game = new ChessGame();
    for (const uci of [
      'g1f3',
      'g8f6',
      'f3g1',
      'f6g8',
      'g1f3',
      'g8f6',
      'f3g1',
      'f6g8',
    ]) {
      applyUci(game, uci);
    }
    expect(game.result).toEqual({
      winner: null,
      reason: 'threefold-repetition',
    });
    expect(game.legalMoves).toEqual([]);
  });
});
