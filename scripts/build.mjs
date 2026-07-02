#!/usr/bin/env node
/* eslint-env node */
/* global process, console */

import { execSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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

console.log(`[build] Running Vite build with "${viteCommand}"...`);
execSync(viteCommand, { stdio: 'inherit' });

// Rolldown (Vite 8) preserves .ts extension in new URL() output chunks
// and does not strip TypeScript annotations. Fix both: rename to .js and
// strip types with esbuild so the browser can parse the result.
const tsAssets = readdirSync(join(distDir, 'assets'), { recursive: false })
  .filter((f) => f.endsWith('.ts') && existsSync(join(distDir, 'assets', f)));
if (tsAssets.length > 0) {
  for (const file of tsAssets) {
    const oldPath = join(distDir, 'assets', file);
    const newPath = oldPath.replace(/\.ts$/, '.js');
    const oldContent = readFileSync(oldPath, 'utf8');
    let jsContent = oldContent;
    try {
      jsContent = execSync(
        `bunx esbuild --loader=ts --target=es2020`,
        { input: oldContent, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' },
      );
    } catch {
      // esbuild unavailable — emit raw content (broken, but better than 404)
    }
    const strippedContent = oldContent !== jsContent ? jsContent : oldContent;
    writeFileSync(newPath, strippedContent);
    rmSync(oldPath);
    console.log(`[build] Renamed ${file} -> ${file.replace(/\.ts$/, '.js')}`);
  }
  const tsRefPattern = new RegExp(
    tsAssets.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'g',
  );
  for (const dir of ['assets', '.vite']) {
    const targetDir = join(distDir, dir);
    if (!existsSync(targetDir)) continue;
    for (const entry of readdirSync(targetDir, { recursive: true })) {
      const file = join(targetDir, entry);
      if (!existsSync(file) || statSync(file).isDirectory()) continue;
      const content = readFileSync(file, 'utf8');
      const updated = content.replaceAll(tsRefPattern, (match) =>
        match.replace(/\.ts$/, '.js'),
      );
      if (updated !== content) {
        writeFileSync(file, updated);
      }
    }
  }
  for (const entry of readdirSync(distDir, { recursive: false })) {
    const file = join(distDir, entry);
    if (!existsSync(file) || statSync(file).isDirectory()) continue;
    const content = readFileSync(file, 'utf8');
    const updated = content.replaceAll(tsRefPattern, (match) =>
      match.replace(/\.ts$/, '.js'),
    );
    if (updated !== content) {
      writeFileSync(file, updated);
    }
  }
}

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
  for (const file of cssFiles) {
    const original = readFileSync(file, 'utf8');
    if (original.length === 0) continue;
    const minified = execSync(`bunx esbuild "${file}" --minify`, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    if (minified.length < original.length) {
      writeFileSync(file, minified);
    }
  }
  console.log(`[build] Minified ${cssFiles.length} CSS file(s).`);
}
