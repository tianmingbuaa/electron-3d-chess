import type { Color, GameResult, MoveRecord } from '@nocturne/chess-shared';
import { COLOR_LABELS } from './pieces';

export interface MovePair {
  moveNumber: number;
  white: MoveRecord | null;
  black: MoveRecord | null;
}

export function pairMoves(history: MoveRecord[]): MovePair[] {
  const rows = new Map<number, MovePair>();
  for (const move of history) {
    const row = rows.get(move.moveNumber) ?? {
      moveNumber: move.moveNumber,
      white: null,
      black: null,
    };
    if (move.color === 'w') row.white = move;
    else row.black = move;
    rows.set(move.moveNumber, row);
  }
  return [...rows.values()].sort((a, b) => a.moveNumber - b.moveNumber);
}

export function resultTitle(result: GameResult | null): string {
  if (!result) return '对局结束';
  if (result.winner) {
    return `${COLOR_LABELS[result.winner]}胜`;
  }
  return '和棋';
}

export function resultSubtitle(result: GameResult | null): string {
  if (!result) return '';
  switch (result.reason) {
    case 'checkmate':
      return '将杀 · Checkmate';
    case 'resignation':
      return '对手认输 · Resignation';
    case 'stalemate':
      return '逼和 · Stalemate';
    case 'threefold-repetition':
      return '三次重复局面 · Threefold repetition';
    case 'insufficient-material':
      return '子力不足 · Insufficient material';
    case 'fifty-move-rule':
      return '五十回合规则 · Fifty-move rule';
    case 'draw':
      return '双方议和 · Draw';
    default:
      return '';
  }
}

export function resultTone(result: GameResult | null): 'win' | 'loss' | 'draw' {
  if (!result?.winner) return 'draw';
  return 'win';
}

export function colorName(color: Color): string {
  return COLOR_LABELS[color];
}
