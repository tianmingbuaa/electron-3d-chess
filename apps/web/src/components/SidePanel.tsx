import { useEffect, useRef } from 'react';
import type {
  AiDifficulty,
  AiProviderInfo,
  Color,
  GameState,
  MoveRecord,
} from '@nocturne/chess-shared';
import { DIFFICULTY_LABELS, PIECE_GLYPHS, PIECE_NAMES, PIECE_VALUES } from '../lib/pieces';
import { pairMoves } from '../lib/format';
import { playInterfaceSound } from '../lib/audio';
import { useGameStore } from '../store/gameStore';
import { Icon } from './Icons';

interface SidePanelProps {
  onClose(): void;
}

function capturedBy(history: MoveRecord[], capturer: Color): MoveRecord[] {
  return history
    .filter((move) => move.color === capturer && move.captured)
    .sort((a, b) => (PIECE_VALUES[b.captured ?? 'p'] ?? 0) - (PIECE_VALUES[a.captured ?? 'p'] ?? 0));
}

function providerLabel(provider: AiProviderInfo | undefined, game: GameState | null, color: Color): string {
  if (game?.ai && game.ai.color === color) return game.ai.providerName;
  return provider?.name ?? 'Atelier Engine';
}

function PlayerCard({
  color,
  game,
  provider,
  setupMode,
}: {
  color: Color;
  game: GameState | null;
  provider: AiProviderInfo | undefined;
  setupMode: 'local' | 'ai';
}) {
  const engineColor = game?.ai?.color;
  const isEngine = game?.mode === 'ai' && engineColor === color;
  const isActive = game?.phase === 'playing' && game.turn === color;
  const thinking = Boolean(isEngine && game?.ai?.thinking);
  const captured = game ? capturedBy(game.history, color) : [];
  const humanName = setupMode === 'ai' ? '你' : color === 'w' ? '玩家 一' : '玩家 二';
  const name = isEngine ? providerLabel(provider, game, color) : humanName;
  const role = isEngine ? 'ATELIER ENGINE' : game?.mode === 'local' ? 'LOCAL PLAYER' : 'HUMAN';

  return (
    <div className={`player-card ${isActive ? 'is-active' : ''} ${thinking ? 'is-thinking' : ''}`}>
      <div className={`player-avatar ${color}`} aria-hidden="true">
        <span>{PIECE_GLYPHS[color].k}</span>
      </div>
      <div className="player-meta">
        <div className="player-name-row">
          <span className="player-name">{name}</span>
          <span className={`player-side ${color}`}>{color === 'w' ? '白' : '黑'}</span>
        </div>
        <div className="player-role">{role}</div>
      </div>
      <div className="player-state">
        {thinking ? (
          <span className="thinking-dots" aria-label="AI 正在思考">
            <i />
            <i />
            <i />
          </span>
        ) : isActive ? (
          <span className="active-indicator">
            <span className="pulse-dot" />
            行棋
          </span>
        ) : (
          <span className="idle-indicator">等待</span>
        )}
      </div>
      {captured.length > 0 && (
        <div className="captured-strip" title={`${name} 缴获的棋子`}>
          {captured.map((move, index) => {
            const type = move.captured;
            return type ? (
              <span
                key={`${move.index}-${index}`}
                className={`captured-glyph ${color === 'w' ? 'black' : 'white'}`}
                title={PIECE_NAMES[type]}
              >
                {PIECE_GLYPHS[color === 'w' ? 'b' : 'w'][type]}
              </span>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}

export function SidePanel({ onClose }: SidePanelProps) {
  const game = useGameStore((state) => state.game);
  const serverInfo = useGameStore((state) => state.serverInfo);
  const setup = useGameStore((state) => state.setup);
  const connection = useGameStore((state) => state.connection);
  const orientation = useGameStore((state) => state.orientation);
  const setMode = useGameStore((state) => state.setMode);
  const setHumanColor = useGameStore((state) => state.setHumanColor);
  const setDifficulty = useGameStore((state) => state.setDifficulty);
  const setProvider = useGameStore((state) => state.setProvider);
  const undo = useGameStore((state) => state.undo);
  const restart = useGameStore((state) => state.restart);
  const requestResign = useGameStore((state) => state.requestResign);
  const reviewRef = useRef<HTMLDivElement>(null);

  const providers = serverInfo?.aiProviders ?? [];
  const provider = providers.find((entry) => entry.id === setup.providerId) ?? providers[0];
  const humanColor: Color = setup.aiColor === 'w' ? 'b' : 'w';
  const rows = game ? pairMoves(game.history) : [];
  const lastIndex = game?.lastMove?.index ?? -1;
  const supportedDifficulties = provider?.capabilities.difficulties ?? [
    'easy',
    'normal',
    'hard',
  ];
  const canInteract = Boolean(game) && connection === 'online';
  const playerOrder: [Color, Color] = orientation === 'w' ? ['b', 'w'] : ['w', 'b'];

  useEffect(() => {
    const node = reviewRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [rows.length]);

  const beginNewGame = (): void => {
    if (!game) return;
    playInterfaceSound('new');
    restart();
  };

  const startResign = (): void => {
    requestResign();
  };

  const changeMode = (mode: 'local' | 'ai'): void => {
    playInterfaceSound('new');
    setMode(mode);
  };

  const changeColor = (color: Color): void => {
    playInterfaceSound('new');
    setHumanColor(color);
  };

  const changeDifficulty = (difficulty: AiDifficulty): void => {
    playInterfaceSound('place');
    setDifficulty(difficulty);
  };

  return (
    <>
      <div className="panel-header">
        <div>
          <p className="eyebrow">THE MATCH</p>
          <h2 className="panel-title">对局</h2>
        </div>
        <button className="icon-button panel-close" onClick={onClose} aria-label="关闭对局面板">
          <Icon name="close" />
        </button>
      </div>

      <div className="duel-stack">
        <PlayerCard color={playerOrder[0]} game={game} provider={provider} setupMode={setup.mode} />
        <div className="duel-rule">
          <span>VS</span>
        </div>
        <PlayerCard color={playerOrder[1]} game={game} provider={provider} setupMode={setup.mode} />
      </div>

      <section className="panel-section setup-section">
        <div className="section-heading">
          <span className="eyebrow">MATCH SETUP</span>
          <span className="section-caption">对局方式</span>
        </div>
        <div className="segmented" role="group" aria-label="对局方式">
          <button
            className={setup.mode === 'local' ? 'is-selected' : ''}
            aria-pressed={setup.mode === 'local'}
            onClick={() => changeMode('local')}
            disabled={!canInteract}
          >
            双人对弈
          </button>
          <button
            className={setup.mode === 'ai' ? 'is-selected' : ''}
            aria-pressed={setup.mode === 'ai'}
            onClick={() => changeMode('ai')}
            disabled={!canInteract}
          >
            人机对弈
          </button>
        </div>

        {setup.mode === 'ai' && (
          <div className="ai-setup">
            <div className="setup-row">
              <span className="field-label">你的执子</span>
              <div className="segmented compact color-choice" role="group" aria-label="你的执子">
                <button
                  className={humanColor === 'w' ? 'is-selected' : ''}
                  aria-pressed={humanColor === 'w'}
                  onClick={() => changeColor('w')}
                  disabled={!canInteract}
                >
                  <i className="side-swatch white" /> 执白
                </button>
                <button
                  className={humanColor === 'b' ? 'is-selected' : ''}
                  aria-pressed={humanColor === 'b'}
                  onClick={() => changeColor('b')}
                  disabled={!canInteract}
                >
                  <i className="side-swatch black" /> 执黑
                </button>
              </div>
            </div>

            <div className="setup-row">
              <span className="field-label">棋力</span>
              <div className="difficulty-row" role="group" aria-label="引擎棋力">
                {supportedDifficulties.map((difficulty) => (
                  <button
                    key={difficulty}
                    className={`difficulty-pill ${setup.difficulty === difficulty ? 'is-selected' : ''}`}
                    aria-pressed={setup.difficulty === difficulty}
                    onClick={() => changeDifficulty(difficulty)}
                    disabled={!canInteract}
                  >
                    {DIFFICULTY_LABELS[difficulty]}
                  </button>
                ))}
              </div>
            </div>

            <div className="engine-row">
              <div className="engine-badge">
                <Icon name="cpu" size={14} />
                <span>ENGINE</span>
              </div>
              {providers.length > 1 ? (
                <select
                  className="engine-select"
                  aria-label="选择 AI 引擎"
                  value={setup.providerId}
                  onChange={(event) => setProvider(event.target.value)}
                  disabled={!canInteract}
                >
                  {providers.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="engine-single">
                  <span>{provider?.name ?? 'Simple Atelier Engine'}</span>
                  <span className="engine-version">v{provider?.version ?? '1.0'}</span>
                </div>
              )}
            </div>
            <p className="setup-hint">修改设置会立即开始一局新棋。</p>
          </div>
        )}
      </section>

      <section className="panel-section review-section">
        <div className="section-heading review-heading">
          <span className="eyebrow">SCORE SHEET</span>
          <span className="section-caption">
            {game?.history.length ? `${game.history.length} 手` : '棋谱'}
          </span>
        </div>
        <div className="review-table" ref={reviewRef}>
          {rows.length === 0 ? (
            <div className="review-empty">
              <span className="review-empty-mark">♘</span>
              <p className="review-empty-title">棋盘静候第一手棋。</p>
              <span className="review-empty-copy">点击棋子，跟随金色落点。</span>
            </div>
          ) : (
            rows.map((row) => (
              <div className="review-row" key={row.moveNumber}>
                <span className="move-number">{row.moveNumber}.</span>
                <span className={`move-san ${row.white?.index === lastIndex ? 'is-latest' : ''}`}>
                  {row.white?.san ?? '—'}
                </span>
                <span className={`move-san ${row.black?.index === lastIndex ? 'is-latest' : ''}`}>
                  {row.black?.san ?? ''}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      <div className="panel-actions">
        <button
          className="action-button"
          onClick={undo}
          disabled={!canInteract || !game?.canUndo}
          title="悔棋（U）"
        >
          <Icon name="undo" size={16} />
          <span>悔棋</span>
        </button>
        <button
          className="action-button"
          onClick={beginNewGame}
          disabled={!canInteract}
          title="重新开始（N）"
        >
          <Icon name="restart" size={16} />
          <span>新局</span>
        </button>
        <button
          className="action-button danger"
          onClick={startResign}
          disabled={!canInteract || game?.phase !== 'playing'}
          title="认输"
        >
          <Icon name="flag" size={16} />
          <span>认输</span>
        </button>
      </div>

      <div className="panel-footer">
        <span className="status-line">
          <i className={`connection-dot ${connection}`} />
          {connection === 'online' ? '本地引擎在线' : connection === 'connecting' ? '正在连接' : '连接中断'}
        </span>
        <span className="protocol">PROTOCOL v{serverInfo?.protocolVersion ?? 1}</span>
      </div>
    </>
  );
}

