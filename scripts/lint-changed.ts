import { $ } from 'bun';

// --staged narrows to the index: the pre-commit hook must gate what is being
// committed, not another session's live working-tree churn (a running
// preview batch's unformatted JSON used to fail every unrelated commit on
// the machine). Default (no flag) keeps the wider working-tree scope for
// interactive `bun run lint:changed` runs.
const stagedOnly = process.argv.includes('--staged');
const rawDiff = stagedOnly
  ? await $`git diff --name-only --cached`.text()
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
  )
  // A deletion also shows up in the diff; Biome errors on paths that no
  // longer exist on disk.
  .filter((f) => Bun.file(f).size > 0);

if (files.length === 0) {
  console.log('No modified or untracked files to lint.');
  process.exit(0);
}

console.log(`Linting ${files.length} changed file(s) with Biome...`);
const result =
  await $`./node_modules/.bin/biome check ${files} --files-ignore-unknown=true`.nothrow();

process.exit(result.exitCode);
