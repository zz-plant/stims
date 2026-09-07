/**
 * Formats only the files touched since HEAD with `biome format --write`, then
 * re-stages them so the formatted text is what gets committed.
 *
 * Covers modified plus untracked JS/TS/JSON/CSS/HTML files (skipping dist/ and
 * node_modules/). `--staged` narrows the scan to the git index for pre-commit
 * hook use.
 */
import { $ } from 'bun';

const stagedOnly = process.argv.includes('--staged');

const rawDiff = stagedOnly
  ? await $`git diff --cached --name-only --diff-filter=d`.text()
  : await $`git diff --name-only HEAD`.text();
const rawUntracked = stagedOnly
  ? ''
  : await $`git ls-files --others --exclude-standard`.text();

const files = [...rawDiff.split('\n'), ...rawUntracked.split('\n')]
  .map((f) => f.trim())
  .filter(Boolean)
  .filter(
    (f) =>
      /\.(js|ts|tsx|jsx|json|css|html|jsonc)$/i.test(f) &&
      !f.startsWith('dist/') &&
      !f.startsWith('node_modules/'),
  );

if (files.length === 0) {
  console.log('No modified or untracked files to format.');
  process.exit(0);
}

console.log(`Formatting ${files.length} changed file(s) with Biome...`);
const result =
  await $`./node_modules/.bin/biome format --write ${files} --files-ignore-unknown=true`
    .quiet()
    .nothrow();

const stderr = result.stderr.toString();
const stdout = result.stdout.toString();
process.stdout.write(stdout);
// Biome exits non-zero when every path it was handed is ignored by
// biome.json, which is not a formatting failure — it is what a commit of
// only generated artifacts (parity suite JSON, screenshots) looks like.
// Treating it as one made those commits impossible through the pre-commit
// hook.
const onlyIgnoredPaths =
  result.exitCode !== 0 && stderr.includes('No files were processed');
if (!onlyIgnoredPaths) {
  process.stderr.write(stderr);
}
const exitCode = onlyIgnoredPaths ? 0 : result.exitCode;
if (onlyIgnoredPaths) {
  console.log('All changed files are ignored by Biome; nothing to format.');
}

if (exitCode === 0 && files.length > 0) {
  await $`git add -- ${files}`.nothrow();
}

process.exit(exitCode);
