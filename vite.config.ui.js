import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'three'],
  },
  root: rootDir,
  publicDir: 'public',
  server: {
    port: 5174,
    host: true,
  },
  build: {
    outDir: 'dist-ui',
    target: 'es2020',
    rollupOptions: {
      input: {
        main: path.resolve(rootDir, 'ui-harness.html'),
      },
    },
  },
});
