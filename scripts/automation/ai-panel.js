(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120; i += 1) {
    if (window.__NOCTURNE_DEBUG__?.store.getState().game) break;
    await wait(200);
  }
  const api = window.__NOCTURNE_DEBUG__;
  api.store.getState().setHumanColor('b');
  for (let i = 0; i < 80; i += 1) {
    const game = api.store.getState().game;
    if (game?.mode === 'ai' && game.history.length > 0) break;
    await wait(200);
  }
  await wait(1200);
  api.store.getState().togglePanel(true);
  await wait(1200);
  return {
    panel: api.store.getState().panelOpen,
    orientation: api.store.getState().orientation,
    ai: api.store.getState().game?.ai,
    moves: api.store.getState().game?.history.length,
  };
})();
