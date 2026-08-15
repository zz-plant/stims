import { $ } from 'bun';

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error(
    'usage: bun scripts/run-biome.ts <check|lint|format> [biome args...]',
  );
  process.exit(1);
}

const command = args[0];
const extraArgs = args.slice(1);

const targets = [
  'src',
  'scripts',
  'tests',
  'package.json',
  'tsconfig.json',
  'biome.json',
  'wrangler.mcp.jsonc',
  'vite.config.js',
  'index.html',
  'milkdrop/index.html',
  'performance/index.html',
  'public/manifest.json',
  'public/test-audio-controls-harness.html',
  '.vscode/settings.json',
  '.vscode/extensions.json',
  '.vscode/launch.json',
  '.vscode/tasks.json',
];

const result =
  await $`./node_modules/.bin/biome ${command} ${targets} --files-ignore-unknown=true ${extraArgs}`.nothrow();

process.exit(result.exitCode);
