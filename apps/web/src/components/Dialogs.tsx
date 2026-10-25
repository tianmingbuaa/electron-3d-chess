import type { PromotionPieceType } from '@nocturne/chess-shared';
import { useEffect } from 'react';
import { playInterfaceSound } from '../lib/audio';
import { PIECE_GLYPHS, PIECE_NAMES } from '../lib/pieces';
import { resultSubtitle, resultTitle } from '../lib/format';
import { resultKey, useGameStore } from '../store/gameStore';
import { Icon } from './Icons';

interface ScrimProps {
  onDismiss(): void;
  children: React.ReactNode;
  labelledBy: string;
  className?: string;
}

function Scrim({ onDismiss, children, labelledBy, className = '' }: ScrimProps) {
  return (
    <div
      className={`modal-scrim ${className}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </div>
    </div>
  );
}

const PROMOTION_ORDER: PromotionPieceType[] = ['q', 'r', 'b', 'n'];

export function PromotionDialog() {
  const promotion = useGameStore((state) => state.promotion);
  const confirmPromotion = useGameStore((state) => state.confirmPromotion);
  const cancelPromotion = useGameStore((state) => state.cancelPromotion);

  useEffect(() => {
    if (!promotion) return;
    const handler = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      if (key === 'escape') {
        event.preventDefault();
        cancelPromotion();
      }
      if (key === 'q' || key === 'r' || key === 'b' || key === 'n') {
        event.preventDefault();
        playInterfaceSound('place');
        confirmPromotion(key);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [promotion, cancelPromotion, confirmPromotion]);

  if (!promotion) return null;

  const choose = (piece: PromotionPieceType): void => {
    playInterfaceSound('place');
    confirmPromotion(piece);
  };

  return (
    <Scrim onDismiss={cancelPromotion} labelledBy="promotion-title" className="promotion-scrim">
      <p className="eyebrow">A CHOICE IN GOLD</p>
      <h2 id="promotion-title" className="modal-title">
        兵临底线
      </h2>
      <p className="modal-description">
        {promotion.from.toUpperCase()} → {promotion.to.toUpperCase()} · 选择升变棋子
      </p>
      <div className="promotion-grid">
        {PROMOTION_ORDER.map((piece) => (
          <button
            key={piece}
            type="button"
            className="promotion-option"
            onClick={() => choose(piece)}
            autoFocus={piece === 'q'}
          >
            <span className={`promotion-glyph ${promotion.color}`} aria-hidden="true">
              {PIECE_GLYPHS[promotion.color][piece]}
            </span>
            <span className="promotion-name">{PIECE_NAMES[piece]}</span>
            <kbd>{piece.toUpperCase()}</kbd>
          </button>
        ))}
      </div>
      <button type="button" className="modal-link" onClick={cancelPromotion}>
        返回棋盘
      </button>
    </Scrim>
  );
}

export function GameOverDialog() {
  const game = useGameStore((state) => state.game);
  const dismissedKey = useGameStore((state) => state.dismissedResultKey);
  const dismissResult = useGameStore((state) => state.dismissResult);
  const restart = useGameStore((state) => state.restart);

  const key = resultKey(game);
  const isOpen = Boolean(game?.phase === 'finished' && game.result && key !== dismissedKey);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') dismissResult();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, dismissResult]);

  if (!game?.result || !isOpen) return null;

  const { result } = game;
  const title =
    game.mode === 'ai' && result.winner
      ? result.winner === game.humanColor
        ? '你赢了'
        : '引擎胜'
      : resultTitle(result);
  const winnerColor = result.winner;
  const moves = Math.ceil(game.history.length / 2);
  const captures = game.history.filter((move) => move.captured).length;

  const playAgain = (): void => {
    playInterfaceSound('new');
    restart();
  };

  return (
    <Scrim onDismiss={dismissResult} labelledBy="result-title" className="result-scrim">
      <div className="result-crest" aria-hidden="true">
        {winnerColor ? PIECE_GLYPHS[winnerColor].k : '◇'}
      </div>
      <p className="eyebrow">FINAL POSITION · 终局</p>
      <h2 id="result-title" className="modal-title result-title">
        {title}
      </h2>
      <p className="modal-description">{resultSubtitle(result)}</p>
      <div className="result-stats">
        <div>
          <span className="stat-value">{moves}</span>
          <span className="stat-label">回合</span>
        </div>
        <div className="stat-divider" />
        <div>
          <span className="stat-value">{captures}</span>
          <span className="stat-label">吃子</span>
        </div>
        <div className="stat-divider" />
        <div>
          <span className="stat-value stat-san">{game.lastMove?.san ?? '—'}</span>
          <span className="stat-label">最后一步</span>
        </div>
      </div>
      <div className="modal-actions">
        <button type="button" className="button-primary" onClick={playAgain}>
          <Icon name="restart" size={16} />
          再来一局
        </button>
        <button type="button" className="button-secondary" onClick={dismissResult}>
          查看棋盘
        </button>
      </div>
    </Scrim>
  );
}

export function ResignDialog() {
  const confirmResign = useGameStore((state) => state.confirmResign);
  const resign = useGameStore((state) => state.resign);
  const cancelResign = useGameStore((state) => state.cancelResign);

  useEffect(() => {
    if (!confirmResign) return;
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancelResign();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [confirmResign, cancelResign]);

  if (!confirmResign) return null;

  return (
    <Scrim onDismiss={cancelResign} labelledBy="resign-title" className="resign-scrim">
      <div className="resign-mark" aria-hidden="true">
        <Icon name="flag" size={22} />
      </div>
      <p className="eyebrow">YIELD THE GAME</p>
      <h2 id="resign-title" className="modal-title">
        投子认负？
      </h2>
      <p className="modal-description">
        认输后本局将立即判定为负。棋谱仍会保留在面板中，供你回看。
      </p>
      <div className="modal-actions">
        <button
          type="button"
          className="button-danger"
          onClick={() => {
            playInterfaceSound('undo');
            resign();
          }}
        >
          确认认输
        </button>
        <button type="button" className="button-secondary" onClick={cancelResign}>
          继续对局
        </button>
      </div>
    </Scrim>
  );
}

export function ToastStack() {
  const toasts = useGameStore((state) => state.toasts);
  const dismissToast = useGameStore((state) => state.dismissToast);

  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <button
          type="button"
          key={toast.id}
          className={`toast ${toast.kind}`}
          onClick={() => dismissToast(toast.id)}
        >
          <span className="toast-mark">{toast.kind === 'error' ? '!' : '◇'}</span>
          <span>{toast.message}</span>
        </button>
      ))}
    </div>
  );
}

export function BootOverlay() {
  const game = useGameStore((state) => state.game);
  const connection = useGameStore((state) => state.connection);
  const detail = useGameStore((state) => state.connectionDetail);

  if (game) return null;

  return (
    <div className="boot-overlay">
      <div className="boot-mark" aria-hidden="true">
        <span>♞</span>
        <i />
      </div>
      <p className="eyebrow">NOCTURNE CHESS</p>
      <h2 className="boot-title">
        {connection === 'offline' ? '棋室尚未点亮' : '正在布置棋盘'}
      </h2>
      <p className="boot-copy">
        {connection === 'offline'
          ? '无法连接本地棋局服务。请稍候，或重新载入棋室。'
          : '连接本地引擎，打磨棋子与光影。'}
      </p>
      {connection === 'offline' ? (
        <div className="boot-actions">
          <button type="button" className="button-primary" onClick={() => window.location.reload()}>
            重新载入
          </button>
          {detail && <span className="boot-detail">{detail}</span>}
        </div>
      ) : (
        <div className="boot-progress" aria-hidden="true">
          <span />
        </div>
      )}
    </div>
  );
}

export function ReconnectBanner() {
  const connection = useGameStore((state) => state.connection);
  if (connection === 'online') return null;
  return (
    <div className={`reconnect-banner ${connection}`} role="status">
      <i className="connection-dot" />
      {connection === 'reconnecting' ? '连接中断 · 正在恢复棋局服务' : '棋局服务离线 · 自动重试中'}
    </div>
  );
}
