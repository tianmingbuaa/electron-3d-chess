/**
 * Shared domain model and wire protocol for Nocturne Chess.
 *
 * This package is intentionally free of Node.js and browser-only APIs. The
 * backend, Electron main process, renderer and future AI providers all consume
 * the same definitions, making the WebSocket protocol the single source of
 * truth between the two halves of the application.
 */

export const PROTOCOL_VERSION = 1 as const;
export const SERVER_NAME = 'Nocturne Chess Server';
export const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type PromotionPieceType = 'q' | 'r' | 'b' | 'n';
export type File = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h';
export type Rank = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
export type Square = `${File}${Rank}`;

export const FILES: readonly File[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const RANKS: readonly Rank[] = ['1', '2', '3', '4', '5', '6', '7', '8'];
export const PROMOTION_PIECES: readonly PromotionPieceType[] = ['q', 'r', 'b', 'n'];

export type GameMode = 'local' | 'ai';
export type AiDifficulty = 'easy' | 'normal' | 'hard';
export type GamePhase = 'playing' | 'finished';

export interface AiConfig {
  providerId: string;
  difficulty: AiDifficulty;
}

export interface NewGameConfig {
  mode: GameMode;
  /** Only meaningful in AI mode. Defaults to white. */
  humanColor?: Color;
  ai?: AiConfig;
}

export interface LegalMove {
  from: Square;
  to: Square;
  san: string;
  promotion?: PromotionPieceType;
}

export interface MoveInput {
  from: Square;
  to: Square;
  promotion?: PromotionPieceType;
}

export interface PieceState {
  /** Stable identity allocated by the server; survives moves and promotion. */
  id: string;
  type: PieceType;
  color: Color;
  square: Square;
}

export interface MoveRecord {
  /** Zero-based ply index. */
  index: number;
  /** Standard full-move number. */
  moveNumber: number;
  san: string;
  from: Square;
  to: Square;
  color: Color;
  piece: PieceType;
  captured?: PieceType;
  promotion?: PromotionPieceType;
}

export interface CapturedPieceInfo {
  id: string;
  type: PieceType;
  color: Color;
  /** Square on which the piece was captured. */
  square: Square;
}

export interface CastlingInfo {
  kingId: string;
  rookId: string;
  rookFrom: Square;
  rookTo: Square;
}

export interface LastMoveInfo extends MoveRecord {
  pieceId: string;
  capturedPiece?: CapturedPieceInfo;
  castling?: CastlingInfo;
}

export type GameResultReason =
  | 'checkmate'
  | 'stalemate'
  | 'threefold-repetition'
  | 'insufficient-material'
  | 'fifty-move-rule'
  | 'draw'
  | 'resignation';

export interface GameResult {
  winner: Color | null;
  reason: GameResultReason;
}

export interface AiStatus {
  color: Color;
  providerId: string;
  providerName: string;
  difficulty: AiDifficulty;
  thinking: boolean;
}

export interface GameState {
  sessionId: string;
  /** Monotonically increasing snapshot version. */
  revision: number;
  fen: string;
  mode: GameMode;
  /** Color controlled by the human in AI mode; null in local mode. */
  humanColor: Color | null;
  ai: AiStatus | null;
  pieces: PieceState[];
  turn: Color;
  phase: GamePhase;
  inCheck: boolean;
  checkSquare: Square | null;
  result: GameResult | null;
  /** Legal destination squares grouped by origin for the side to move. */
  legalMoves: Partial<Record<Square, Square[]>>;
  history: MoveRecord[];
  lastMove: LastMoveInfo | null;
  canUndo: boolean;
  /** Full-move number of the current position. */
  moveNumber: number;
}

/* -------------------------------------------------------------------------- */
/*                                  AI SPI                                    */
/* -------------------------------------------------------------------------- */

export interface AiProviderCapabilities {
  difficulties: AiDifficulty[];
  supportsTimeLimit: boolean;
  supportsCancellation: boolean;
  /** True for a provider that calls out to a remote engine/service. */
  remote: boolean;
}

export interface AiProviderInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  capabilities: AiProviderCapabilities;
}

export interface AiMoveRequest {
  fen: string;
  color: Color;
  turn: Color;
  history: MoveRecord[];
  legalMoves: LegalMove[];
  difficulty: AiDifficulty;
  /** Soft budget. Providers should honor it when their capability says so. */
  timeLimitMs: number;
  /** Aborted when a game is restarted, undone, or the socket disconnects. */
  signal: AbortSignal;
}

export interface AiMoveChoice {
  from: Square;
  to: Square;
  promotion?: PromotionPieceType;
  san?: string;
  /** Optional telemetry displayed by future clients. */
  evaluationCp?: number;
  depth?: number;
  nodes?: number;
  providerData?: unknown;
}

/**
 * Stable extension point for chess AI engines.
 *
 * Implementations must be side-effect free with respect to game state: the
 * authoritative server validates and applies the returned move.
 */
export interface AiProvider {
  readonly info: AiProviderInfo;
  init?(): Promise<void> | void;
  chooseMove(request: AiMoveRequest): Promise<AiMoveChoice | null>;
  dispose?(): Promise<void> | void;
}

/* -------------------------------------------------------------------------- */
/*                                HTTP / runtime                              */
/* -------------------------------------------------------------------------- */

export interface RuntimeInfo {
  serverName: string;
  serverVersion: string;
  protocolVersion: typeof PROTOCOL_VERSION;
  /** WebSocket path, resolved against window.location.host by the renderer. */
  wsPath: string;
  token: string;
}

export interface HealthInfo {
  ok: boolean;
  serverName: string;
  serverVersion: string;
  protocolVersion: typeof PROTOCOL_VERSION;
  uptimeSeconds: number;
}

/* -------------------------------------------------------------------------- */
/*                              WebSocket protocol                            */
/* -------------------------------------------------------------------------- */

export interface ServerInfo {
  name: string;
  version: string;
  protocolVersion: typeof PROTOCOL_VERSION;
  aiProviders: AiProviderInfo[];
}

export type ClientMessage =
  | { type: 'new_game'; requestId?: string; config: NewGameConfig }
  | { type: 'move'; requestId?: string; move: MoveInput }
  | { type: 'undo'; requestId?: string }
  | { type: 'restart'; requestId?: string }
  | { type: 'resign'; requestId?: string }
  | { type: 'ping'; requestId?: string };

export type ProtocolErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'invalid_move'
  | 'illegal_move'
  | 'not_your_turn'
  | 'game_over'
  | 'ai_busy'
  | 'unsupported'
  | 'internal_error';

export interface ProtocolError {
  code: ProtocolErrorCode;
  message: string;
}

export type ServerMessage =
  | {
      type: 'welcome';
      info: ServerInfo;
      state: GameState;
    }
  | {
      type: 'state';
      state: GameState;
      requestId?: string;
      notice?: string;
    }
  | {
      type: 'error';
      error: ProtocolError;
      requestId?: string;
    }
  | {
      type: 'pong';
      requestId?: string;
    };

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

export const DEFAULT_AI_CONFIG: AiConfig = {
  providerId: 'simple',
  difficulty: 'normal',
};

export const DEFAULT_GAME_CONFIG: NewGameConfig = {
  mode: 'local',
};

export function oppositeColor(color: Color): Color {
  return color === 'w' ? 'b' : 'w';
}

export function isPromotionPieceType(value: unknown): value is PromotionPieceType {
  return typeof value === 'string' && (PROMOTION_PIECES as readonly string[]).includes(value);
}

export function isFile(value: unknown): value is File {
  return typeof value === 'string' && (FILES as readonly string[]).includes(value);
}

export function isRank(value: unknown): value is Rank {
  return typeof value === 'string' && (RANKS as readonly string[]).includes(value);
}

export function isSquare(value: unknown): value is Square {
  return (
    typeof value === 'string' &&
    value.length === 2 &&
    isFile(value[0]) &&
    isRank(value[1])
  );
}
