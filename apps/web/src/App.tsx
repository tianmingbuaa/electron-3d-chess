import { useEffect } from 'react';
import { ChessSocket } from './lib/socket';
import { primeAudio } from './lib/audio';
import { bindSocket, resultKey, useGameStore } from './store/gameStore';
import { Header } from './components/Header';
import { SidePanel } from './components/SidePanel';
import { TurnDock } from './components/TurnDock';
import { BootOverlay, GameOverDialog, PromotionDialog, ReconnectBanner, ResignDialog, ToastStack } from './components/Dialogs';
import { ChessScene } from './scene/ChessScene';

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, select, textarea, [contenteditable="true"]'));
}

function App() {
  const panelOpen = useGameStore((state) => state.panelOpen);
  const togglePanel = useGameStore((state) => state.togglePanel);

  useEffect(() => {
    const socket = new ChessSocket({
      onMessage: (message) => {
        useGameStore.getState().handleServerMessage(message);
      },
      onStatus: (status, detail) => {
        useGameStore.getState().setConnection(status, detail);
      },
    });
    bindSocket(socket);
    socket.start();
    return () => {
      socket.stop();
      bindSocket(null);
    };
  }, []);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('debug')) return;
    (window as unknown as { __NOCTURNE_DEBUG__: unknown }).__NOCTURNE_DEBUG__ = {
      store: useGameStore,
      select: (square: string) => useGameStore.getState().selectSquare(square as never),
    };
  }, []);

  useEffect(() => {
    const prime = (): void => primeAudio();
    window.addEventListener('pointerdown', prime, { once: true });
    return () => window.removeEventListener('pointerdown', prime);
  }, []);

  useEffect(() => {
    let disposed = false;
    const bridge = window.nocturneDesktop;
    if (bridge) {
      void bridge.getInfo().then((info) => {
        if (disposed) return;
        document.documentElement.classList.add('is-electron');
        document.documentElement.classList.add(`platform-${info.platform}`);
      });
    }
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isTextInput(event.target)) return;
      const state = useGameStore.getState();
      const hasOpenDialog = Boolean(
        state.promotion ||
          state.confirmResign ||
          (state.game?.phase === 'finished' &&
            state.game.result &&
            state.dismissedResultKey !== resultKey(state.game)),
      );
      const key = event.key.toLowerCase();

      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault();
        if (!hasOpenDialog) state.undo();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;

      if (key === 'escape') {
        if (hasOpenDialog) return;
        if (state.panelOpen) state.togglePanel(false);
        else state.clearSelection();
        return;
      }
      if (hasOpenDialog) return;

      if (key === 'u') {
        event.preventDefault();
        state.undo();
      } else if (key === 'f') {
        event.preventDefault();
        state.flipBoard();
      } else if (key === 'm') {
        event.preventDefault();
        state.toggleSound();
      } else if (key === 'n') {
        event.preventDefault();
        state.restart();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className={`app-shell ${panelOpen ? 'is-panel-open' : ''}`}>
      <Header />

      <main className="stage">
        <div className="stage-atmosphere" aria-hidden="true" />
        <div className="scene-layer">
          <ChessScene />
        </div>
        <ReconnectBanner />
        <TurnDock />
        <div className="stage-corner-mark" aria-hidden="true">
          <span>MMXXVI</span>
          <i />
          <span>ATELIER</span>
        </div>
      </main>

      <aside className={`side-panel ${panelOpen ? 'is-open' : ''}`}>
        <SidePanel onClose={() => togglePanel(false)} />
      </aside>

      {panelOpen && (
        <button
          type="button"
          className="panel-backdrop"
          aria-label="关闭对局面板"
          onClick={() => togglePanel(false)}
        />
      )}

      <ToastStack />
      <PromotionDialog />
      <ResignDialog />
      <GameOverDialog />
      <BootOverlay />
    </div>
  );
}

export default App;
