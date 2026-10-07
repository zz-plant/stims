import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'three'],
    // The workspace packages under packages/ export their TypeScript source
    // under 'stims-source' and their built dist/ otherwise, so the app runs
    // on the packages' source without building them first.
    conditions: ['stims-source', ...defaultClientConditions],
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
    rolldownOptions: {
      input: {
        main: path.resolve(rootDir, 'ui-harness.html'),
      },
    },
  },
});
