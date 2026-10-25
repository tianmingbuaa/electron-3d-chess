(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 160; i += 1) {
    if (window.__NOCTURNE_DEBUG__?.store.getState().game) break;
    await wait(250);
  }
  const api = window.__NOCTURNE_DEBUG__;
  api.store.getState().setHumanColor('b');
  for (let i = 0; i < 100; i += 1) {
    const game = api.store.getState().game;
    if (game?.mode === 'ai' && game.humanColor === 'b' && game.history.length > 0) break;
    await wait(250);
  }
  await wait(5000);
  const game = api.store.getState().game;
  return { mode: game?.mode, humanColor: game?.humanColor, moves: game?.history.length, thinking: game?.ai?.thinking };
})();
