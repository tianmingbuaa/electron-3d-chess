import type { File, Rank, Square } from '@nocturne/chess-shared';

/** Build a typed square from a file and rank. */
export function makeSquare(file: File, rank: Rank): Square {
  return `${file}${rank}`;
}

export function fileOf(square: Square): File {
  return square[0] as File;
}

export function rankOf(square: Square): Rank {
  return square[1] as Rank;
}

/**
 * Return the square diagonally/orthogonally implied by two squares sharing a
 * file or rank. Used for en-passant capture bookkeeping.
 */
export function replaceFile(square: Square, file: File): Square {
  return makeSquare(file, rankOf(square));
}
