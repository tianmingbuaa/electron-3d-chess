(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 160; i += 1) {
    if (window.__NOCTURNE_DEBUG__?.store.getState().game) break;
    await wait(250);
  }
  await wait(1200);
  if (!window.__NOCTURNE_PROJECT_SQUARE__) throw new Error('projector unavailable');
  const canvas = document.querySelector('canvas');
  if (!canvas) throw new Error('canvas missing');

  const clickSquare = async (square) => {
    const p = window.__NOCTURNE_PROJECT_SQUARE__(square);
    const fire = (type, buttons) => {
      canvas.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: p.x,
          clientY: p.y,
          pointerId: 11,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons,
        }),
      );
    };
    fire('pointermove', 0);
    fire('pointerover', 0);
    fire('pointerdown', 1);
    fire('pointerup', 0);
    fire('click', 0);
    await wait(350);
    return p;
  };

  const p2 = await clickSquare('e2');
  const selected = window.__NOCTURNE_DEBUG__.store.getState().selected;
  if (selected !== 'e2') throw new Error(`click e2 failed (${JSON.stringify({ selected, p2 })})`);
  const p4 = await clickSquare('e4');
  for (let i = 0; i < 30; i += 1) {
    if (window.__NOCTURNE_DEBUG__.store.getState().game.history.length > 0) break;
    await wait(100);
  }
  await wait(500);
  const game = window.__NOCTURNE_DEBUG__.store.getState().game;
  return { p2, p4, selected, san: game.history[0]?.san, turn: game.turn };
})();
