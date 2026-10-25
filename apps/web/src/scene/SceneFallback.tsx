import { Component, type ErrorInfo, type ReactNode } from 'react';
import { FILES, RANKS, type Square } from '@nocturne/chess-shared';
import { PIECE_GLYPHS, COLOR_LABELS } from '../lib/pieces';
import { canHumanMove, useGameStore } from '../store/gameStore';

function FallbackBoard() {
  const game = useGameStore((state) => state.game);
  const selected = useGameStore((state) => state.selected);
  const orientation = useGameStore((state) => state.orientation);
  const selectSquare = useGameStore((state) => state.selectSquare);

  if (!game) return null;

  const files = orientation === 'w' ? [...FILES] : [...FILES].reverse();
  const ranks = orientation === 'w' ? [...RANKS].reverse() : [...RANKS];
  const pieces = new Map(game.pieces.map((piece) => [piece.square, piece]));
  const targets = new Set(selected ? game.legalMoves[selected] ?? [] : []);
  const selectedPiece = selected ? pieces.get(selected) : undefined;
  const canMove = canHumanMove(game);

  return (
    <div className="fallback-board-shell">
      <div
        className="fallback-board"
        role="grid"
        aria-label="经典二维棋盘"
        style={{ gridTemplateColumns: 'repeat(8, 1fr)' }}
      >
        {ranks.map((rank) =>
          files.map((file) => {
            const square = `${file}${rank}` as Square;
            const piece = pieces.get(square);
            const dark = (FILES.indexOf(file) + RANKS.indexOf(rank)) % 2 === 1;
            return (
              <button
                type="button"
                key={square}
                role="gridcell"
                aria-label={`${square}${piece ? `，${COLOR_LABELS[piece.color]}${piece.type.toUpperCase()}` : ''}`}
                className={`fallback-square ${dark ? 'dark' : 'light'} ${
                  selected === square ? 'is-selected' : ''
                } ${targets.has(square) ? 'is-target' : ''}`}
                onClick={() => {
                  if (canMove) selectSquare(square);
                }}
              >
                {targets.has(square) && !piece && <span className="fallback-target-dot" />}
                {targets.has(square) && piece && <span className="fallback-target-ring" />}
                {piece && (
                  <span className={`fallback-piece ${piece.color}`}>
                    {PIECE_GLYPHS[piece.color][piece.type]}
                  </span>
                )}
                {selected === square && selectedPiece && <span className="fallback-selected-mark" />}
              </button>
            );
          }),
        )}
      </div>
      <div className="fallback-coordinates" aria-hidden="true">
        <span>经典视图</span>
        <span>
          {files.join('  ')}
        </span>
      </div>
    </div>
  );
}

interface BoundaryState {
  hasError: boolean;
}

export class SceneErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[scene] 3D renderer failed, using the 2D fallback', error, info);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="scene-fallback">
          <div className="scene-fallback-notice">
            <span>3D 场景暂时不可用，已启用经典棋盘。</span>
          </div>
          <FallbackBoard />
        </div>
      );
    }
    return this.props.children;
  }
}
