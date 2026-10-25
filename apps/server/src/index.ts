/**
 * Public API of @nocturne/chess-server.
 *
 * The server is deliberately split into four independently testable layers:
 * rules (`ChessGame`), AI extension point (`AiProviderRegistry` + providers),
 * protocol/session orchestration (`GameSession`) and transport
 * (`createChessServer`).
 */

export {
  createChessServer,
  type ChessServer,
  type CreateChessServerOptions,
} from './server.js';

export {
  ChessGame,
  PIECE_ID_FORMAT,
  type ChessGameOptions,
  type ChessGameResignResult,
} from './chess-game.js';

export { GameSession, type GameSessionOptions } from './session.js';

export {
  AiProviderRegistry,
  AI_DIFFICULTIES,
  createAiProviderRegistry,
  isAiDifficulty,
} from './ai/registry.js';

export {
  SimpleAiProvider,
  createSimpleAiProvider,
  SIMPLE_AI_DEPTH_BY_DIFFICULTY,
  SIMPLE_AI_PROVIDER_ID,
  SIMPLE_AI_PROVIDER_INFO,
  SIMPLE_AI_PROVIDER_NAME,
  SIMPLE_AI_PROVIDER_VERSION,
  SIMPLE_AI_TIME_BUDGET_MS,
  type SimpleAiProviderOptions,
} from './ai/simple-provider.js';

export { ChessError, isChessError } from './errors.js';

export {
  parseClientMessage,
  DEFAULT_AI_MOVE_DELAY_MS,
  DEFAULT_AI_PROVIDER_ID,
  DEFAULT_AI_TIMEOUT_MS,
  DEFAULT_HOST,
  DEFAULT_PORT,
  MAX_REQUEST_ID_LENGTH,
  SERVER_IDENTITY,
  SERVER_VERSION,
  WS_PATH,
  type ParseClientMessageResult,
  type ParseFailure,
  type ParseSuccess,
} from './protocol.js';

export {
  defaultLog,
  safeLog,
  type LogFn,
  type LogLevel,
} from './logging.js';

export { StaticFileServer } from './static.js';
