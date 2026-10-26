import { defineConfig } from 'tsup';

/**
 * Container/server-room build: bundle the server together with its runtime
 * dependencies (ws, chess.js and shared protocol types) so the Docker runtime
 * stage does not need node_modules or any package installation.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['cjs'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist-container',
  outExtension: () => ({ js: '.cjs' }),
  noExternal: ['@nocturne/chess-shared', 'chess.js', 'ws'],
  sourcemap: false,
  clean: true,
  dts: false,
  splitting: false,
  minify: false,
});
