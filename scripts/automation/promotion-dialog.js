(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 160; i += 1) {
    if (window.__NOCTURNE_DEBUG__?.store.getState().game) break;
    await wait(250);
  }
  const api = window.__NOCTURNE_DEBUG__;
  const play = async (from, to, expectedPly) => {
    api.store.getState().selectSquare(from);
    await wait(90);
    api.store.getState().selectSquare(to);
    for (let i = 0; i < 40; i += 1) {
      if (api.store.getState().game.history.length >= expectedPly) return;
      await wait(100);
    }
    throw new Error(`move ${from}${to} not applied; history=${api.store.getState().game.history.length}`);
  };

  await play('a2', 'a4', 1);
  await play('g8', 'f6', 2);
  await play('a4', 'a5', 3);
  await play('f6', 'g8', 4);
  await play('a5', 'a6', 5);
  await play('g8', 'f6', 6);
  await play('a6', 'b7', 7);
  await play('f6', 'g8', 8);

  api.store.getState().selectSquare('b7');
  await wait(150);
  api.store.getState().selectSquare('a8');
  await wait(900);
  const ui = window.__NOCTURNE_DEBUG__.store.getState();
  const game = ui.game;
  return {
    promotionOpen: Boolean(ui.promotion),
    promotion: ui.promotion,
    history: game.history.map((m) => m.san),
    turn: game.turn,
    phase: game.phase,
  };
})();
