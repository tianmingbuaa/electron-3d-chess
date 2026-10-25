#!/usr/bin/env bash
# Build the production renderer/Electron bundle and capture the actual window
# through Electron's own capturePage API. Useful as a visual smoke test.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

pnpm build:web >/dev/null
pnpm build:desktop >/dev/null

OUT="${1:-$ROOT/artifacts/nocturne-chess.png}"
mkdir -p "$(dirname "$OUT")"

EXTRA_ARGS=()
if [[ "$(id -u)" -eq 0 ]]; then
  EXTRA_ARGS+=(--no-sandbox)
fi

if [[ -n "${CHESS_SOFTWARE_GL:-}" ]]; then
  EXTRA_ARGS+=(--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist --disable-gpu-sandbox)
fi

if [[ -z "${DISPLAY:-}" ]]; then
  # Headless environments need SwiftShader; shader compilation is slow but works.
  env -u WAYLAND_DISPLAY \
    CHESS_CAPTURE_PATH="$OUT" \
    CHESS_CAPTURE_DELAY="${CHESS_CAPTURE_DELAY:-18000}" \
    ELECTRON_OZONE_PLATFORM_HINT=x11 \
    xvfb-run -a -s "-screen 0 1600x1000x24" \
    pnpm exec electron --ozone-platform=x11 \
      --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader \
      --ignore-gpu-blocklist --disable-gpu-sandbox "${EXTRA_ARGS[@]}" .
else
  CHESS_CAPTURE_PATH="$OUT" CHESS_CAPTURE_DELAY="${CHESS_CAPTURE_DELAY:-6000}" \
    pnpm exec electron "${EXTRA_ARGS[@]}" .
fi

echo "Captured $OUT"
