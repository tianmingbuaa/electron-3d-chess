import type {
  AiDifficulty,
  Color,
  GameMode,
  PieceType,
  ServerInfo,
  ServerMessage,
  Square,
} from '@nocturne/chess-shared';
import { create } from 'zustand';
import { playMoveSound, playResultSound } from '../lib/audio';
import type { ChessSocket, ConnectionStatus } from '../lib/socket';

export interface GameSetup {
  mode: GameMode;
  /** Color played by the AI. The human takes the opposite color. */
  aiColor: Color;
  difficulty: AiDifficulty;
  providerId: string;
}

export interface PromotionPrompt {
  from: Square;
  to: Square;
  color: Color;
}

export interface Toast {
  id: number;
  kind: 'info' | 'error';
  message: string;
}

interface GameStore {
  game: GameStateLike | null;
  serverInfo: ServerInfo | null;
  connection: ConnectionStatus;
  connectionDetail: string | null;
  setup: GameSetup;
  selected: Square | null;
  orientation: Color;
  soundEnabled: boolean;
  panelOpen: boolean;
  promotion: PromotionPrompt | null;
  confirmResign: boolean;
  toasts: Toast[];
  dismissedResultKey: string | null;

  handleServerMessage(message: ServerMessage): void;
  setConnection(status: ConnectionStatus, detail?: string): void;
  selectSquare(square: Square): void;
  clearSelection(): void;
  setMode(mode: GameMode): void;
  setHumanColor(color: Color): void;
  setDifficulty(difficulty: AiDifficulty): void;
  setProvider(providerId: string): void;
  restart(): void;
  undo(): void;
  requestResign(): void;
  resign(): void;
  cancelResign(): void;
  flipBoard(): void;
  toggleSound(): void;
  togglePanel(open?: boolean): void;
  confirmPromotion(piece: PieceType): void;
  cancelPromotion(): void;
  dismissResult(): void;
  pushToast(message: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
}

type GameStateLike = import('@nocturne/chess-shared').GameState;

let activeSocket: ChessSocket | null = null;
let toastCounter = 0;

export function bindSocket(socket: ChessSocket | null): void {
  activeSocket = socket;
}

function dispatch(message: Parameters<ChessSocket['send']>[0]): boolean {
  return activeSocket?.send(message) ?? false;
}

function readOrientation(): Color {
  try {
    const stored = localStorage.getItem('nocturne.orientation');
    return stored === 'b' ? 'b' : 'w';
  } catch {
    return 'w';
  }
}

function readSoundPreference(): boolean {
  try {
    return localStorage.getItem('nocturne.sound') !== 'off';
  } catch {
    return true;
  }
}

export function canHumanMove(game: GameStateLike | null): boolean {
  if (!game || game.phase !== 'playing' || game.ai?.thinking) return false;
  if (game.mode === 'local') return true;
  return game.humanColor === game.turn;
}

export function isAiTurn(game: GameStateLike | null): boolean {
  return Boolean(game?.ai && game.turn === game.ai.color && game.phase === 'playing');
}

export function resultKey(game: GameStateLike | null): string | null {
  return game?.phase === 'finished' && game.result
    ? `${game.sessionId}:${game.result.reason}:${game.result.winner ?? 'draw'}`
    : null;
}

const ERROR_COPY: Record<string, string> = {
  bad_request: '请求格式无效，已忽略。',
  unauthorized: '访问令牌已失效，请重新连接。',
  invalid_move: '无法识别这一步棋。',
  illegal_move: '这一步不符合国际象棋规则。',
  not_your_turn: '还没有轮到你走棋。',
  game_over: '对局已经结束。',
  ai_busy: 'AI 正在思考，请稍候。',
  unsupported: '当前对局模式暂不支持该操作。',
  internal_error: '棋局引擎出现异常，已保留当前局面。',
};

const pieceExistsAt = (game: GameStateLike, square: Square): boolean =>
  game.pieces.some((piece) => piece.square === square);

const currentSideCanMove = (game: GameStateLike): boolean => {
  if (!canHumanMove(game)) return false;
  return game.pieces.some((piece) => piece.color === game.turn);
};

export const useGameStore = create<GameStore>((set, get) => {
  const notify = (message: string, kind: Toast['kind'] = 'info'): void => {
    const id = ++toastCounter;
    set((state) => ({ toasts: [...state.toasts.slice(-2), { id, kind, message }] }));
    window.setTimeout(() => {
      const { dismissToast } = get();
      dismissToast(id);
    }, 4_200);
  };

  const applyState = (state: GameStateLike): void => {
    const previous = get().game;
    const previousLastMove = previous?.lastMove ?? null;
    const isNewSession = !previous || previous.sessionId !== state.sessionId;
    const configurationChanged =
      !previous || previous.mode !== state.mode || previous.humanColor !== state.humanColor;

    let orientation = get().orientation;
    if ((isNewSession || configurationChanged) && state.mode === 'ai' && state.humanColor) {
      orientation = state.humanColor;
    }

    let selected = get().selected;
    if (selected) {
      const selectedPiece = state.pieces.find((piece) => piece.square === selected);
      if (
        !selectedPiece ||
        selectedPiece.color !== state.turn ||
        !currentSideCanMove(state)
      ) {
        selected = null;
      }
    }

    let promotion = get().promotion;
    if (promotion && (state.turn !== promotion.color || state.phase === 'finished')) {
      promotion = null;
    }

    const setup = { ...get().setup };
    if (state.ai) {
      setup.mode = 'ai';
      setup.aiColor = state.ai.color;
      setup.difficulty = state.ai.difficulty;
      setup.providerId = state.ai.providerId;
    } else {
      setup.mode = 'local';
    }

    let dismissedResultKey = get().dismissedResultKey;
    if (state.phase !== 'finished') dismissedResultKey = null;

    set({
      game: state,
      setup,
      orientation,
      selected,
      promotion,
      dismissedResultKey,
    });

    if (state.lastMove && (!previousLastMove || state.lastMove.index > previousLastMove.index)) {
      if (get().soundEnabled) {
        playMoveSound({
          capture: Boolean(state.lastMove.captured),
          check: state.inCheck,
        });
      }
    }

    if (state.phase === 'finished' && state.result && previous?.phase !== 'finished') {
      if (get().soundEnabled) playResultSound(state.result.winner);
    }
  };

  const startWithSetup = (patch: Partial<GameSetup>): void => {
    const setup: GameSetup = { ...get().setup, ...patch };
    set({ setup, selected: null, promotion: null, panelOpen: false, confirmResign: false });
    const config =
      setup.mode === 'local'
        ? { mode: 'local' as const }
        : {
            mode: 'ai' as const,
            humanColor: (setup.aiColor === 'w' ? 'b' : 'w') as Color,
            ai: {
              providerId: setup.providerId,
              difficulty: setup.difficulty,
            },
          };
    const sent = dispatch({ type: 'new_game', config });
    if (!sent) notify('与本地棋局服务的连接尚未就绪。', 'error');
  };

  return {
    game: null,
    serverInfo: null,
    connection: 'connecting',
    connectionDetail: null,
    setup: {
      mode: 'local',
      aiColor: 'b',
      difficulty: 'normal',
      providerId: 'simple',
    },
    selected: null,
    orientation: readOrientation(),
    soundEnabled: readSoundPreference(),
    panelOpen: false,
    promotion: null,
    confirmResign: false,
    toasts: [],
    dismissedResultKey: null,

    handleServerMessage: (message) => {
      switch (message.type) {
        case 'welcome': {
          const providers = message.info.aiProviders;
          const known = providers.some((provider) => provider.id === get().setup.providerId);
          set({
            serverInfo: message.info,
            setup: {
              ...get().setup,
              providerId: known
                ? get().setup.providerId
                : providers[0]?.id ?? get().setup.providerId,
            },
            connection: 'online',
            connectionDetail: null,
          });
          applyState(message.state);
          break;
        }
        case 'state': {
          applyState(message.state);
          break;
        }
        case 'error': {
          const copy = ERROR_COPY[message.error.code] ?? message.error.message;
          if (message.error.code === 'illegal_move' || message.error.code === 'invalid_move') {
            set({ selected: null });
          }
          notify(copy, 'error');
          break;
        }
        case 'pong':
          break;
      }
    },

    setConnection: (status, detail) => {
      set({ connection: status, connectionDetail: detail ?? null });
      if (status === 'offline' && get().game) {
        notify('连接中断，正在等待本地棋局服务恢复。', 'error');
      }
    },

    selectSquare: (square) => {
      const game = get().game;
      if (!game) return;
      if (!currentSideCanMove(game)) return;

      const selected = get().selected;
      if (selected) {
        const targets = game.legalMoves[selected] ?? [];
        if (targets.includes(square)) {
          const mover = game.pieces.find((piece) => piece.square === selected);
          if (mover?.type === 'p' && (square.endsWith('8') || square.endsWith('1'))) {
            set({ promotion: { from: selected, to: square, color: game.turn } });
            return;
          }
          const sent = dispatch({ type: 'move', move: { from: selected, to: square } });
          if (!sent) {
            notify('连接已断开，无法发送走棋。', 'error');
            return;
          }
          set({ selected: null, promotion: null });
          return;
        }

        if (selected === square) {
          set({ selected: null });
          return;
        }
      }

      const clickedPiece = game.pieces.find((piece) => piece.square === square);
      if (clickedPiece?.color === game.turn) {
        set({ selected: square, promotion: null });
      } else {
        set({ selected: null });
      }
    },

    clearSelection: () => set({ selected: null }),

    setMode: (mode) => {
      if (mode === get().setup.mode) return;
      startWithSetup({ mode });
    },

    setHumanColor: (color) => {
      const aiColor: Color = color === 'w' ? 'b' : 'w';
      if (aiColor === get().setup.aiColor && get().setup.mode === 'ai') return;
      startWithSetup({ aiColor, mode: 'ai' });
    },

    setDifficulty: (difficulty) => {
      if (difficulty === get().setup.difficulty) return;
      startWithSetup({ difficulty, mode: 'ai' });
    },

    setProvider: (providerId) => {
      if (providerId === get().setup.providerId) return;
      const provider = get().serverInfo?.aiProviders.find((entry) => entry.id === providerId);
      const supported = provider?.capabilities.difficulties ?? [];
      const difficulty = supported.includes(get().setup.difficulty)
        ? get().setup.difficulty
        : supported[0] ?? get().setup.difficulty;
      startWithSetup({ providerId, difficulty, mode: 'ai' });
    },

    restart: () => {
      if (!dispatch({ type: 'restart' })) {
        notify('与本地棋局服务的连接尚未就绪。', 'error');
        return;
      }
      set({ selected: null, promotion: null, confirmResign: false });
    },

    undo: () => {
      const game = get().game;
      if (!game || !game.canUndo) {
        notify(game?.ai?.thinking ? 'AI 正在思考，暂时无法悔棋。' : '当前没有可撤销的棋步。');
        return;
      }
      if (!dispatch({ type: 'undo' })) {
        notify('连接已断开，无法悔棋。', 'error');
        return;
      }
      set({ selected: null, promotion: null });
    },

    requestResign: () => {
      const game = get().game;
      if (!game || game.phase !== 'playing') return;
      set({ confirmResign: true });
    },

    resign: () => {
      const game = get().game;
      if (!game || game.phase !== 'playing') return;
      dispatch({ type: 'resign' });
      set({ confirmResign: false, selected: null });
    },

    cancelResign: () => set({ confirmResign: false }),

    flipBoard: () => {
      const orientation = get().orientation === 'w' ? 'b' : 'w';
      set({ orientation, selected: null });
      try {
        localStorage.setItem('nocturne.orientation', orientation);
      } catch {
        // Preferences are optional.
      }
    },

    toggleSound: () => {
      const soundEnabled = !get().soundEnabled;
      set({ soundEnabled });
      try {
        localStorage.setItem('nocturne.sound', soundEnabled ? 'on' : 'off');
      } catch {
        // Preferences are optional.
      }
      if (soundEnabled) notify('声音已开启');
    },

    togglePanel: (open) => {
      set((state) => ({ panelOpen: open ?? !state.panelOpen }));
    },

    confirmPromotion: (piece) => {
      const promotion = get().promotion;
      if (!promotion) return;
      if (piece !== 'q' && piece !== 'r' && piece !== 'b' && piece !== 'n') return;
      const sent = dispatch({
        type: 'move',
        move: { from: promotion.from, to: promotion.to, promotion: piece },
      });
      if (!sent) notify('连接已断开，无法完成升变。', 'error');
      set({ promotion: null, selected: null });
    },

    cancelPromotion: () => set({ promotion: null }),

    dismissResult: () => {
      const key = resultKey(get().game);
      set({ dismissedResultKey: key });
    },

    pushToast: (message, kind = 'info') => notify(message, kind),

    dismissToast: (id) => {
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    },
  };
});

export function hasPieceAt(square: Square): boolean {
  const game = useGameStore.getState().game;
  return Boolean(game && pieceExistsAt(game, square));
}
