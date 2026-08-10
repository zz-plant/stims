#!/usr/bin/env node
// Copies @resvg/resvg-wasm's wasm binary into functions/api/ so Cloudflare
// Pages Functions can import it with a relative path. Pages Functions
// bundling does not reliably resolve .wasm imports out of node_modules,
// and Workers forbids compiling wasm from runtime-fetched bytes, so a
// vendored module import is the only path that works in production.
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(
  root,
  'node_modules',
  '@resvg',
  'resvg-wasm',
  'index_bg.wasm',
);
const target = join(root, 'functions', 'api', 'resvg.wasm');

if (!existsSync(source)) {
  console.error(
    '[sync-resvg-wasm] @resvg/resvg-wasm is not installed; run bun install first.',
  );
  process.exit(1);
}

const sourceBytes = readFileSync(source);
const targetBytes = existsSync(target) ? readFileSync(target) : null;
if (targetBytes && Buffer.compare(sourceBytes, targetBytes) === 0) {
  console.log('[sync-resvg-wasm] functions/api/resvg.wasm is up to date.');
} else {
  copyFileSync(source, target);
  console.log(
    `[sync-resvg-wasm] Copied index_bg.wasm -> functions/api/resvg.wasm (${sourceBytes.length} bytes).`,
  );
}
