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
  await $`./node_modules/.bin/biome format --write ${files} --files-ignore-unknown=true`.nothrow();

if (result.exitCode === 0 && files.length > 0) {
  await $`git add -- ${files}`.nothrow();
}

process.exit(result.exitCode);
