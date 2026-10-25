import {
  DEFAULT_AI_CONFIG,
  PROTOCOL_VERSION,
  SERVER_NAME,
  isPromotionPieceType,
  isSquare,
  type AiConfig,
  type ClientMessage,
  type Color,
  type GameMode,
  type MoveInput,
  type NewGameConfig,
  type ProtocolError,
  type ProtocolErrorCode,
  type ServerInfo,
} from '@nocturne/chess-shared';
import { isAiDifficulty } from './ai/registry.js';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 0;
export const DEFAULT_AI_PROVIDER_ID = DEFAULT_AI_CONFIG.providerId;
export const DEFAULT_AI_MOVE_DELAY_MS = 350;
export const DEFAULT_AI_TIMEOUT_MS = 10_000;
export const SERVER_VERSION = '1.0.0';
export const WS_PATH = '/ws';
export const MAX_REQUEST_ID_LENGTH = 128;

export const SERVER_IDENTITY = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  protocolVersion: PROTOCOL_VERSION,
} as const;

export interface ParseSuccess {
  ok: true;
  message: ClientMessage;
}

export interface ParseFailure {
  ok: false;
  error: ProtocolError;
  requestId?: string;
}

export type ParseClientMessageResult = ParseSuccess | ParseFailure;

function failure(
  code: ProtocolErrorCode,
  message: string,
  requestId?: string,
): ParseFailure {
  const result: ParseFailure = { ok: false, error: { code, message } };
  if (requestId !== undefined) result.requestId = requestId;
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isColor(value: unknown): value is Color {
  return value === 'w' || value === 'b';
}

function isGameMode(value: unknown): value is GameMode {
  return value === 'local' || value === 'ai';
}

/** Read an optional request ID, validating its type and length. */
function readRequestId(
  record: Record<string, unknown>,
): { ok: true; value?: string } | { ok: false } {
  if (!Object.prototype.hasOwnProperty.call(record, 'requestId')) {
    return { ok: true };
  }
  const value = record.requestId;
  if (value === undefined) return { ok: true };
  if (typeof value !== 'string' || value.length > MAX_REQUEST_ID_LENGTH) {
    return { ok: false };
  }
  return { ok: true, value };
}

function parseAiConfig(value: unknown): AiConfig | null {
  if (!isRecord(value)) return null;
  if (typeof value.providerId !== 'string' || value.providerId.trim() === '') {
    return null;
  }
  if (value.providerId.length > 64) return null;
  if (!isAiDifficulty(value.difficulty)) return null;
  return {
    providerId: value.providerId,
    difficulty: value.difficulty,
  };
}

function parseNewGameConfig(value: unknown): NewGameConfig | null {
  if (!isRecord(value)) return null;
  if (!isGameMode(value.mode)) return null;

  if (value.mode === 'local') {
    return { mode: 'local' };
  }

  const config: NewGameConfig = { mode: 'ai' };
  if (value.humanColor !== undefined) {
    if (!isColor(value.humanColor)) return null;
    config.humanColor = value.humanColor;
  }
  if (value.ai !== undefined) {
    const ai = parseAiConfig(value.ai);
    if (ai === null) return null;
    config.ai = ai;
  }
  return config;
}

function parseMoveInput(value: unknown): MoveInput | null {
  if (!isRecord(value)) return null;
  if (!isSquare(value.from) || !isSquare(value.to)) return null;
  const move: MoveInput = { from: value.from, to: value.to };
  if (value.promotion !== undefined) {
    if (!isPromotionPieceType(value.promotion)) return null;
    move.promotion = value.promotion;
  }
  return move;
}

/**
 * Parse and validate untrusted client JSON.
 *
 * This function never throws: malformed or hostile input becomes a protocol
 * error so the transport can keep the socket open.
 */
export function parseClientMessage(raw: string): ParseClientMessageResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return failure('bad_request', 'Message must be valid JSON.');
  }

  if (!isRecord(parsed)) {
    return failure('bad_request', 'Message must be a JSON object.');
  }

  const requestIdResult = readRequestId(parsed);
  if (!requestIdResult.ok) {
    return failure(
      'bad_request',
      `requestId must be a string of at most ${MAX_REQUEST_ID_LENGTH} characters.`,
    );
  }
  const requestId = requestIdResult.value;

  const type = parsed.type;
  if (typeof type !== 'string') {
    return failure('bad_request', 'Message must include a string "type" field.', requestId);
  }

  switch (type) {
    case 'ping':
      return { ok: true, message: { type: 'ping', ...(requestId === undefined ? {} : { requestId }) } };

    case 'undo':
    case 'restart':
    case 'resign':
      return { ok: true, message: { type, ...(requestId === undefined ? {} : { requestId }) } };

    case 'new_game': {
      const config = parseNewGameConfig(parsed.config);
      if (config === null) {
        return failure(
          'bad_request',
          'new_game requires a valid config: { mode: "local" } or { mode: "ai", humanColor?, ai? }.',
          requestId,
        );
      }
      return {
        ok: true,
        message: {
          type: 'new_game',
          config,
          ...(requestId === undefined ? {} : { requestId }),
        },
      };
    }

    case 'move': {
      const move = parseMoveInput(parsed.move);
      if (move === null) {
        return failure(
          'bad_request',
          'move requires { from, to } squares and an optional promotion piece (q, r, b or n).',
          requestId,
        );
      }
      return {
        ok: true,
        message: {
          type: 'move',
          move,
          ...(requestId === undefined ? {} : { requestId }),
        },
      };
    }

    default:
      return failure('bad_request', `Unknown command type "${type}".`, requestId);
  }
}

export interface ServerInfoOptions {
  version?: string;
  providers: ServerInfo['aiProviders'];
}

export function createServerInfo(options: ServerInfoOptions): ServerInfo {
  return {
    name: SERVER_IDENTITY.name,
    version: options.version ?? SERVER_IDENTITY.version,
    protocolVersion: PROTOCOL_VERSION,
    aiProviders: options.providers,
  };
}
