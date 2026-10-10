import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  // Bundle the shared package (it ships TypeScript source).
  noExternal: ['@wtc/shared'],
});
