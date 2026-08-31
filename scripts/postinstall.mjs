#!/usr/bin/env node
/**
 * Runs post-install setup: the resvg WASM sync, Husky hooks, and the
 * Cloudflare Pages build of dist/.
 *
 * Each step is skipped where it does not apply — STIMS_SKIP_POSTINSTALL_BUILD=1
 * disables the WASM sync and the Pages build, and hooks are skipped in CI or
 * when Bun is not the installer.
 */

import { execSync } from 'node:child_process';

const userAgent = process.env.npm_config_user_agent ?? '';
const isBunUserAgent = userAgent.startsWith('bun');
const isCloudflarePages = (() => {
  const value = process.env.CF_PAGES?.toLowerCase?.();
  return value === '1' || value === 'true';
})();
const skipCloudflareBuild = process.env.STIMS_SKIP_POSTINSTALL_BUILD === '1';
const isCI = process.env.CI === 'true' || process.env.HUSKY === '0';

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

// Skip WASM sync in CI when node_modules haven't changed (the lockfile key
// means the binary is already cached). Also skip when STIMS_SKIP_POSTINSTALL_BUILD
// is set, which is used by the build script's own install step.
if (!skipCloudflareBuild && !process.env.STIMS_SKIP_POSTINSTALL_BUILD) {
  run(
    hasBun
      ? 'bun scripts/sync-resvg-wasm.mjs'
      : 'node scripts/sync-resvg-wasm.mjs',
  );
}

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

if (isCI || isCloudflarePages) {
  console.log('[postinstall] Husky install skipped (CI/CF Pages).');
} else if (isBunUserAgent) {
  run('husky');
} else {
  console.log(
    '[postinstall] Husky install skipped (Bun not detected as installer).',
  );
}
