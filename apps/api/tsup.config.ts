import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/demo/seed-cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  // The shared workspace package ships TypeScript source, so bundle it in.
  noExternal: ['@flowsync/shared'],
});
