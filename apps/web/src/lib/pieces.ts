import type { AiDifficulty, Color, PieceType } from '@nocturne/chess-shared';

export const PIECE_NAMES: Record<PieceType, string> = {
  k: '国王',
  q: '王后',
  r: '城堡',
  b: '主教',
  n: '骑士',
  p: '兵',
};

export const PIECE_GLYPHS: Record<Color, Record<PieceType, string>> = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};

export const PIECE_VALUES: Record<PieceType, number> = {
  k: 0,
  q: 9,
  r: 5,
  b: 3.2,
  n: 3,
  p: 1,
};

export const DIFFICULTY_LABELS: Record<AiDifficulty, string> = {
  easy: '入门',
  normal: '标准',
  hard: '进阶',
};

export const DIFFICULTY_DESCRIPTIONS: Record<AiDifficulty, string> = {
  easy: '一步预判',
  normal: '两层搜索',
  hard: '三层搜索',
};

export const COLOR_LABELS: Record<Color, string> = {
  w: '白方',
  b: '黑方',
};

export function describeMaterial(material: string | undefined): string {
  if (material === 'k') return '王';
  if (material === 'q') return '后';
  if (material === 'r') return '车';
  if (material === 'b') return '象';
  if (material === 'n') return '马';
  if (material === 'p') return '兵';
  return '';
}
