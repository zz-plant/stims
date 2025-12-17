import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import toysData from './assets/js/toys-data.js';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const moduleInputs = Object.fromEntries(
  toysData
    .filter((toy) => toy.type === 'module')
    .map((toy) => [toy.module, path.resolve(rootDir, toy.module)])
);

export default defineConfig({
  build: {
    outDir: 'dist',
    manifest: true,
    rollupOptions: {
      input: {
        main: path.resolve(rootDir, 'index.html'),
        ...moduleInputs,
      },
    },
  },
});
