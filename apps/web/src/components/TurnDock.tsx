import type { Color } from '@nocturne/chess-shared';
import { resultSubtitle, resultTitle } from '../lib/format';
import { COLOR_LABELS, PIECE_GLYPHS } from '../lib/pieces';
import { canHumanMove, useGameStore } from '../store/gameStore';

export function TurnDock() {
  const game = useGameStore((state) => state.game);
  const selected = useGameStore((state) => state.selected);

  if (!game) return null;
  const finished = game.phase === 'finished' && game.result;
  const thinking = Boolean(game.ai?.thinking);
  const turn: Color = game.turn;
  const canMove = canHumanMove(game);
  const isAi = game.mode === 'ai' && game.ai?.color === turn;

  let title = `${COLOR_LABELS[turn]}行棋`;
  let subtitle = canMove ? '点选棋子，再选择目标格。' : '等待引擎落子。';

  if (finished && game.result) {
    title = resultTitle(game.result);
    subtitle = resultSubtitle(game.result);
  } else if (thinking) {
    title = '引擎正在思考';
    subtitle = `${game.ai?.providerName ?? 'AI'} · 正在计算落子`;
  } else if (selected) {
    title = `${COLOR_LABELS[turn]}行棋`;
    subtitle = `已选中 ${selected.toUpperCase()}，请选择目标格。`;
  } else if (isAi) {
    title = `${COLOR_LABELS[turn]}行棋`;
    subtitle = '引擎准备落子…';
  }

  return (
    <div
      className={`turn-dock ${finished ? 'is-finished' : ''} ${thinking ? 'is-thinking' : ''} ${
        game.inCheck && !finished ? 'is-check' : ''
      }`}
      aria-live="polite"
    >
      <div className={`turn-medallion ${turn}`} aria-hidden="true">
        <span>{PIECE_GLYPHS[turn].k}</span>
      </div>
      <div className="turn-copy">
        <div className="turn-title-row">
          <span className="turn-title">{title}</span>
          {game.inCheck && !finished && <span className="check-chip">CHECK</span>}
          {thinking && (
            <span className="thinking-dots">
              <i />
              <i />
              <i />
            </span>
          )}
        </div>
        <span className="turn-subtitle">{subtitle}</span>
      </div>
      <div className="turn-shortcuts" aria-hidden="true">
        <span>
          <kbd>U</kbd> 悔棋
        </span>
        <span>
          <kbd>F</kbd> 翻面
        </span>
      </div>
    </div>
  );
}
