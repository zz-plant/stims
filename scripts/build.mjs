#!/usr/bin/env node
/* eslint-env node */
/* global process, console */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const normalizeBoolean = (value) => value?.toLowerCase?.() ?? '';
const reuseDist =
  process.argv.includes('--reuse') ||
  ['1', 'true'].includes(normalizeBoolean(process.env.STIMS_REUSE_DIST));
const isCloudflarePages = ['1', 'true'].includes(
  normalizeBoolean(process.env.CF_PAGES),
);
const distDir = join(process.cwd(), 'dist');
const distIndex = join(distDir, 'index.html');
const manifest = join(distDir, '.vite', 'manifest.json');
const hasReusableArtifacts = () =>
  existsSync(distIndex) && existsSync(manifest);
const vitePackagePath = join(
  process.cwd(),
  'node_modules',
  'vite',
  'package.json',
);

if (hasReusableArtifacts() && (isCloudflarePages || reuseDist)) {
  console.log(
    reuseDist
      ? '[build] dist/ already populated; skipping Vite rebuild (--reuse enabled).'
      : '[build] CF_PAGES detected and dist/ already populated; skipping Vite rebuild.',
  );
  process.exit(0);
}

const hasBunRuntime = typeof process.versions?.bun === 'string';
const installCommand = 'bun install --frozen-lockfile';
const installEnv = {
  ...process.env,
  STIMS_SKIP_POSTINSTALL_BUILD: '1',
};
const viteCommand = 'bunx vite build';

if (!hasBunRuntime) {
  console.error(
    '[build] Bun is required to install dependencies and run the Vite build.',
  );
  process.exit(1);
}

if (!existsSync(vitePackagePath)) {
  console.log(`[build] Installing dependencies with "${installCommand}"...`);
  execSync(installCommand, { env: installEnv, stdio: 'inherit' });

  if (hasReusableArtifacts() && (isCloudflarePages || reuseDist)) {
    console.log(
      reuseDist
        ? '[build] dist/ already populated after install; skipping Vite rebuild (--reuse enabled).'
        : '[build] CF_PAGES detected and dist/ already populated after install; skipping Vite rebuild.',
    );
    process.exit(0);
  }
}

console.log('[build] Generating catalog search index...');
execSync('bun run scripts/generate-catalog-search-index.ts', {
  stdio: 'inherit',
});

console.log(`[build] Running Vite build with "${viteCommand}"...`);
execSync(viteCommand, { stdio: 'inherit' });

// Vite/Rolldown in this project does not minify CSS comments and whitespace.
// Post-process CSS assets with esbuild for smaller transfer and parse cost.
const esbuildPackagePath = join(
  process.cwd(),
  'node_modules',
  'esbuild',
  'package.json',
);
if (existsSync(esbuildPackagePath)) {
  console.log('[build] Minifying CSS assets...');
  const cssFiles = readdirSync(distDir, { recursive: true })
    .map((entry) => join(distDir, entry))
    .filter(
      (file) =>
        file.endsWith('.css') && existsSync(file) && !file.endsWith('.map'),
    );
  // Import esbuild's JS API once and transform in-process. The previous
  // version spawned a fresh `bunx esbuild` subprocess per file — each one
  // paying bun's binary-resolution cost on top of esbuild startup — which
  // dominated this step's wall time on catalogs with dozens of CSS assets.
  const { transform } = await import('esbuild');
  await Promise.all(
    cssFiles.map(async (file) => {
      const original = readFileSync(file, 'utf8');
      if (original.length === 0) return;
      const { code: minified } = await transform(original, {
        loader: 'css',
        minify: true,
      });
      if (minified.length < original.length) {
        writeFileSync(file, minified);
      }
    }),
  );
  console.log(`[build] Minified ${cssFiles.length} CSS file(s).`);
}
