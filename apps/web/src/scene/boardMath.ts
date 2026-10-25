import type { File, Rank, Square } from '@nocturne/chess-shared';
import { FILES, RANKS } from '@nocturne/chess-shared';

export const BOARD_HALF = 4;
export const FRAME_HALF = 4.65;
export const BASE_HALF = 4.84;
export const PIECE_BASE_Y = 0.012;

export function parseSquare(square: Square): { fileIndex: number; rankIndex: number } {
  const file = square[0] as File;
  const rank = square[1] as Rank;
  return {
    fileIndex: FILES.indexOf(file),
    rankIndex: RANKS.indexOf(rank),
  };
}

/** Local board coordinates before the board group is rotated for orientation. */
export function squareToBoardPosition(square: Square): { x: number; z: number } {
  const { fileIndex, rankIndex } = parseSquare(square);
  return {
    x: fileIndex - 3.5,
    z: 3.5 - rankIndex,
  };
}

export function squareAt(fileIndex: number, rankIndex: number): Square {
  const file = FILES[fileIndex];
  const rank = RANKS[rankIndex];
  if (!file || !rank) throw new Error(`Invalid board coordinate ${fileIndex},${rankIndex}`);
  return `${file}${rank}` as Square;
}

export function isDarkSquare(square: Square): boolean {
  const { fileIndex, rankIndex } = parseSquare(square);
  return (fileIndex + rankIndex) % 2 === 1;
}
