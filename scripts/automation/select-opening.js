(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120; i += 1) {
    const api = window.__NOCTURNE_DEBUG__;
    const game = api?.store.getState().game;
    if (game) break;
    await wait(250);
  }
  const api = window.__NOCTURNE_DEBUG__;
  api.store.getState().selectSquare('e2');
  await wait(900);
  return { selected: api.store.getState().selected, phase: api.store.getState().game?.phase };
})();
