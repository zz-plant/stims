import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
  esbuild: {
    loader: 'tsx',
    include: /assets\/js\/.*\.[tj]sx?$/,
  },
});
