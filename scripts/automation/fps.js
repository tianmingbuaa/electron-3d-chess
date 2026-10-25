(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120; i += 1) {
    if (window.__NOCTURNE_DEBUG__?.store.getState().game) break;
    await wait(200);
  }
  await wait(1500);
  const frames = [];
  let previous = performance.now();
  await new Promise((resolve) => {
    const start = performance.now();
    const tick = (now) => {
      frames.push(now - previous);
      previous = now;
      if (now - start >= 3000) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  frames.sort((a, b) => a - b);
  const sum = frames.reduce((acc, value) => acc + value, 0);
  return {
    frames: frames.length,
    avgMs: Number((sum / frames.length).toFixed(2)),
    medianMs: Number(frames[Math.floor(frames.length / 2)]?.toFixed(2)),
    p95Ms: Number(frames[Math.floor(frames.length * 0.95)]?.toFixed(2)),
    maxMs: Number(frames.at(-1)?.toFixed(2)),
    approxFps: Number((1000 / (sum / frames.length)).toFixed(1)),
    dpr: window.devicePixelRatio,
    canvas: `${document.querySelector('canvas')?.width}x${document.querySelector('canvas')?.height}`,
  };
})();
