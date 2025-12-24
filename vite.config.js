import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import toysData from './assets/js/toys-data.js';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const htmlInputs = Object.fromEntries(
  fs
    .readdirSync(rootDir)
    .filter((entry) => entry.endsWith('.html'))
    .sort()
    .map((file) => [path.parse(file).name, path.resolve(rootDir, file)])
);
const moduleInputs = Object.fromEntries(
  toysData
    .filter((toy) => toy.type === 'module')
    .map((toy) => [toy.module, path.resolve(rootDir, toy.module)])
);

export default defineConfig({
  server: {
    // Bind to all interfaces so forwarded browsers (e.g., Playwright) can reach
    // the dev server instead of seeing connection refused.
    host: true,
  },
  build: {
    outDir: 'dist',
    // Emit the standard .vite/manifest.json so docs and tooling resolve assets
    // without custom paths.
    manifest: true,
    rollupOptions: {
      // Keep the toy entry exports intact so dynamic imports from the homepage
      // can find the `start` functions even when they look unused at build time.
      preserveEntrySignatures: 'strict',
      input: {
        main: htmlInputs.index ?? path.resolve(rootDir, 'index.html'),
        ...htmlInputs,
        ...moduleInputs,
      },
    },
  },
});
