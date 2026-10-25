import type { ProtocolErrorCode } from '@nocturne/chess-shared';

/**
 * A rules/validation failure that can be mapped directly onto the wire
 * protocol. The transport layer catches this type and emits an `error`
 * message without tearing down the socket.
 */
export class ChessError extends Error {
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode, message: string) {
    super(message);
    this.name = 'ChessError';
    this.code = code;
  }
}

export function isChessError(value: unknown): value is ChessError {
  return value instanceof ChessError;
}
