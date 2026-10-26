# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# Build stage: renderer + self-contained browser game server
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS build

ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN npm install --global --no-audit --no-fund --ignore-scripts pnpm@12.11.2

WORKDIR /workspace

# Manifests are copied separately so Docker can cache dependency resolution.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/desktop/package.json ./apps/desktop/package.json
COPY packages/shared/package.json ./packages/shared/package.json

# Only the web and server projects are needed in the image (no Electron).
RUN pnpm install --frozen-lockfile \
      --filter @nocturne/chess-web... \
      --filter @nocturne/chess-server...

COPY packages/shared ./packages/shared
COPY apps/server ./apps/server
COPY apps/web ./apps/web
COPY scripts/serve-web.mjs ./scripts/serve-web.mjs

RUN pnpm --filter @nocturne/chess-web build \
 && pnpm --filter @nocturne/chess-server build:container

# ---------------------------------------------------------------------------
# Runtime stage: static renderer + one self-contained server bundle
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="Nocturne Chess Web" \
      org.opencontainers.image.description="Browser-first 3D chess atelier with a local authoritative game server" \
      org.opencontainers.image.source="https://github.com/tianmingbuaa/electron-3d-chess" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    CHESS_HOST=0.0.0.0 \
    CHESS_PORT=8787 \
    CHESS_NO_OPEN=1 \
    CHESS_STATIC_DIR=/app/apps/web/dist \
    CHESS_SERVER_ENTRY=/app/apps/server/server.cjs

WORKDIR /app

COPY --from=build --chown=node:node /workspace/apps/web/dist ./apps/web/dist
COPY --from=build --chown=node:node /workspace/apps/server/dist-container/index.cjs ./apps/server/server.cjs
COPY --chown=node:node scripts/serve-web.mjs ./scripts/serve-web.mjs
COPY --chown=node:node LICENSE ./

USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.CHESS_PORT || '8787') + '/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

STOPSIGNAL SIGTERM

CMD ["node", "scripts/serve-web.mjs"]
