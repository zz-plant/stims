#!/usr/bin/env node
/* eslint-env node */
/* global process, console */

import { execSync } from 'node:child_process';

const userAgent = process.env.npm_config_user_agent ?? '';
const isBunUserAgent = userAgent.startsWith('bun');
const isCloudflarePages = (() => {
  const value = process.env.CF_PAGES?.toLowerCase?.();
  return value === '1' || value === 'true';
})();
const skipCloudflareBuild = process.env.STIMS_SKIP_POSTINSTALL_BUILD === '1';

const run = (command) => {
  execSync(command, { stdio: 'inherit' });
};

const hasBun = (() => {
  if (isBunUserAgent) return true;
  try {
    execSync('bun --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

if (isCloudflarePages) {
  if (skipCloudflareBuild) {
    console.log(
      '[postinstall] Skipping Cloudflare Pages build (postinstall build disabled).',
    );
  } else {
    if (!hasBun) {
      console.error(
        '[postinstall] Bun is required to build dist/ on Cloudflare Pages.',
      );
      process.exit(1);
    }
    console.log(
      '[postinstall] Cloudflare Pages detected; running "bun run build" to produce dist/.',
    );
    run('bun run build');
  }
} else {
  console.log('[postinstall] CF_PAGES not set; skipping build.');
}

if (isBunUserAgent) {
  run('husky install');
} else {
  console.log(
    '[postinstall] Husky install skipped (Bun not detected as installer).',
  );
}
