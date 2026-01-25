#!/usr/bin/env node
/* eslint-env node */
/* global process, console */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const normalizeBoolean = (value) => value?.toLowerCase?.() ?? '';
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

if (isCloudflarePages && hasReusableArtifacts()) {
  console.log(
    '[build] CF_PAGES detected and dist/ already populated; skipping Vite rebuild.',
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

  if (isCloudflarePages && hasReusableArtifacts()) {
    console.log(
      '[build] CF_PAGES detected and dist/ already populated after install; skipping Vite rebuild.',
    );
    process.exit(0);
  }
}

console.log(`[build] Running Vite build with "${viteCommand}"...`);
execSync(viteCommand, { stdio: 'inherit' });
