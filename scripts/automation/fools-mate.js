(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const apiReady = async () => {
    for (let i = 0; i < 160; i += 1) {
      if (window.__NOCTURNE_DEBUG__?.store.getState().game) return window.__NOCTURNE_DEBUG__;
      await wait(250);
    }
    throw new Error('game did not initialize');
  };
  const api = await apiReady();
  const play = async (from, to) => {
    const before = api.store.getState().game.history.length;
    api.store.getState().selectSquare(from);
    await wait(80);
    api.store.getState().selectSquare(to);
    for (let i = 0; i < 40; i += 1) {
      const game = api.store.getState().game;
      if (game.history.length > before) return;
      await wait(100);
    }
    throw new Error(`move ${from}${to} was not applied`);
  };
  await play('f2', 'f3');
  await play('e7', 'e5');
  await play('g2', 'g4');
  await play('d8', 'h4');
  for (let i = 0; i < 40; i += 1) {
    if (api.store.getState().game.phase === 'finished') break;
    await wait(100);
  }
  await wait(800);
  const game = api.store.getState().game;
  return { phase: game.phase, result: game.result, history: game.history.map((m) => m.san) };
})();
