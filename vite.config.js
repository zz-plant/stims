import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import toysData from './assets/js/toys-data.js';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const getHtmlInputs = (dir) => {
  if (!fs.existsSync(dir)) return {};
  return Object.fromEntries(
    fs
      .readdirSync(dir)
      .filter((entry) => entry.endsWith('.html'))
      .sort()
      .map((file) => [path.parse(file).name, path.resolve(dir, file)]),
  );
};

const htmlInputs = {
  index: path.resolve(rootDir, 'index.html'),
  toy: path.resolve(rootDir, 'toy.html'),
  ...getHtmlInputs(path.resolve(rootDir, 'toys')),
};
const moduleInputs = Object.fromEntries(
  toysData
    .filter((toy) => toy.type === 'module')
    .map((toy) => [toy.module, path.resolve(rootDir, toy.module)]),
);
const rollupInputs = {
  ...htmlInputs,
  ...moduleInputs,
};

if (!rollupInputs.index) {
  rollupInputs.index = path.resolve(rootDir, 'index.html');
}

export default defineConfig({
  server: {
    // Bind to all interfaces so forwarded browsers (e.g., Playwright) can reach
    // the dev server instead of seeing connection refused.
    host: true,
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    // Emit the standard .vite/manifest.json so docs and tooling resolve assets
    // without custom paths.
    manifest: true,
    rollupOptions: {
      // Keep the toy entry exports intact so dynamic imports from the homepage
      // can find the `start` functions even when they look unused at build time.
      preserveEntrySignatures: 'strict',
      input: rollupInputs,
    },
  },
});
