import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outDir: 'dist',
  dts: true,
  clean: true,
  outExtensions: () => ({
    js: '.js',
    dts: '.d.ts',
  }),
})