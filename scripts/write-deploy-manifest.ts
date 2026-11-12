/**
 * Writes `dist/deploy-manifest.json`, `{"commit":"<40-hex sha>"}`, so a check can ask the live site which commit it serves.
 *
 * Workers Builds deploys on push and reports nothing back to the site, so
 * whether a merge reached https://toil.fyi could only be judged by looking.
 * The manifest is served at /deploy-manifest.json; a check compares its
 * commit with the one it expects.
 *
 * The commit comes from `WORKERS_CI_COMMIT_SHA`, which Cloudflare Workers
 * Builds sets on every build, and otherwise from `git rev-parse HEAD`, for
 * `site:deploy` and `site:preview` run by hand. Anything but 40 hex digits
 * fails the build: a manifest naming no commit, or the wrong one, would
 * answer the check with something false.
 *
 * `site:build` runs it last, after the Vite build has emptied and refilled
 * dist/. `DEPLOY_OUTPUT_DIR` writes it elsewhere (the unit test uses it).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const rootDir = join(import.meta.dir, '..');
const outputDir = process.env.DEPLOY_OUTPUT_DIR ?? join(rootDir, 'dist');

function localCommit(): string {
  const result = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], {
    cwd: rootDir,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    console.error(
      `[deploy-manifest] WORKERS_CI_COMMIT_SHA is unset and git rev-parse HEAD failed: ${result.stderr.toString().trim()}`,
    );
    process.exit(1);
  }
  return result.stdout.toString().trim();
}

const commit = process.env.WORKERS_CI_COMMIT_SHA?.trim() || localCommit();

if (!/^[0-9a-f]{40}$/i.test(commit)) {
  console.error(
    `[deploy-manifest] Invalid deployment commit SHA: "${commit}" (expected 40 hex digits)`,
  );
  process.exit(1);
}

const path = join(outputDir, 'deploy-manifest.json');
writeFileSync(path, `${JSON.stringify({ commit })}\n`);
console.log(`[deploy-manifest] ${path}: ${commit}`);
