import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
  },
  esbuild: {
    loader: 'ts',
    include: /assets\/js\/.*\.ts$/,
  },
});
