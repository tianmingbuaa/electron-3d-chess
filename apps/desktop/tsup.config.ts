import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    main: 'src/main.ts',
    preload: 'src/preload.ts',
  },
  format: ['cjs'],
  target: 'node22',
  platform: 'node',
  outExtension: () => ({ js: '.cjs' }),
  external: ['electron'],
  noExternal: ['@nocturne/chess-server', '@nocturne/chess-shared', 'chess.js', 'ws'],
  sourcemap: true,
  clean: true,
  splitting: false,
  dts: false,
});
