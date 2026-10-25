import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['cjs'],
  target: 'node22',
  platform: 'node',
  outExtension: () => ({ js: '.cjs' }),
  noExternal: ['@nocturne/chess-shared'],
  sourcemap: true,
  clean: true,
  dts: false,
  splitting: false,
});
