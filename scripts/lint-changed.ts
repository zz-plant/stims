import { $ } from 'bun';

const rawDiff = await $`git diff --name-only HEAD`.text();
const rawUntracked = await $`git ls-files --others --exclude-standard`.text();

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
  console.log('No modified or untracked files to lint.');
  process.exit(0);
}

console.log(`Linting ${files.length} changed file(s) with Biome...`);
const result =
  await $`./node_modules/.bin/biome check ${files} --files-ignore-unknown=true`.nothrow();

process.exit(result.exitCode);
