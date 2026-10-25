import { useGameStore } from '../store/gameStore';
import { Icon } from './Icons';

const CONNECTION_LABELS = {
  connecting: '连接棋局',
  online: '本地服务在线',
  reconnecting: '正在重连',
  offline: '连接中断',
} as const;

export function Header() {
  const connection = useGameStore((state) => state.connection);
  const soundEnabled = useGameStore((state) => state.soundEnabled);
  const toggleSound = useGameStore((state) => state.toggleSound);
  const flipBoard = useGameStore((state) => state.flipBoard);
  const togglePanel = useGameStore((state) => state.togglePanel);
  const panelOpen = useGameStore((state) => state.panelOpen);

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-emblem" aria-hidden="true">
          <span>♞</span>
        </div>
        <div className="brand-copy">
          <div className="brand-title-row">
            <h1>NOCTURNE</h1>
            <span className="brand-diamond">◇</span>
          </div>
          <p>CHESS ATELIER</p>
        </div>
      </div>

      <div className="topbar-rule" aria-hidden="true">
        <span />
        <i />
        <span />
      </div>

      <div className="topbar-actions">
        <div className={`connection-pill ${connection}`} role="status" aria-live="polite">
          <i className="connection-dot" />
          <span>{CONNECTION_LABELS[connection]}</span>
        </div>
        <button
          type="button"
          className={`icon-button ${soundEnabled ? 'is-active' : ''}`}
          onClick={toggleSound}
          aria-label={soundEnabled ? '关闭声音' : '开启声音'}
          title={soundEnabled ? '关闭声音（M）' : '开启声音（M）'}
        >
          <Icon name={soundEnabled ? 'volume' : 'mute'} size={17} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={flipBoard}
          aria-label="翻转棋盘"
          title="翻转棋盘（F）"
        >
          <Icon name="flip" size={17} />
        </button>
        <button
          type="button"
          className={`icon-button panel-trigger ${panelOpen ? 'is-active' : ''}`}
          onClick={() => togglePanel()}
          aria-label="打开对局面板"
          aria-expanded={panelOpen}
        >
          <Icon name={panelOpen ? 'close' : 'panel'} size={17} />
        </button>
      </div>
    </header>
  );
}
