#!/usr/bin/env node
/* eslint-env node */
/* global process, console */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const normalizeBoolean = (value) => value?.toLowerCase?.() ?? '';
const isCloudflarePages = ['1', 'true'].includes(
  normalizeBoolean(process.env.CF_PAGES)
);
const distDir = join(process.cwd(), 'dist');
const distIndex = join(distDir, 'index.html');
const manifest = join(distDir, '.vite', 'manifest.json');
const hasReusableArtifacts = existsSync(distIndex) && existsSync(manifest);

if (isCloudflarePages && hasReusableArtifacts) {
  console.log(
    '[build] CF_PAGES detected and dist/ already populated; skipping Vite rebuild.'
  );
  process.exit(0);
}

console.log('[build] Running Vite build...');
execSync('vite build', { stdio: 'inherit' });
