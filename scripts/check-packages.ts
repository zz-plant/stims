/**
 * Typechecks and tests every standalone package under packages/, each in its
 * own directory so its bunfig.toml and tsconfig apply rather than the root's.
 *
 * The packages are extracted from this repo and published on their own, so
 * nothing else in the gate exercises them: the root tsconfig does not include
 * packages/, and the root test runner only walks tests/. This is the guard
 * that keeps them green between releases.
 *
 *   bun run check:packages              # typecheck + test each package
 *   bun run check:packages -- --build   # also emit dist/ to prove tsc can
 *   bun run check:packages -- flash-guard   # one package
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PACKAGES_DIR = join(ROOT, 'packages');
const TSC = join(ROOT, 'node_modules', '.bin', 'tsc');

const args = process.argv.slice(2);
const build = args.includes('--build');
const only = args.filter((a) => !a.startsWith('--'));

const packages = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => existsSync(join(PACKAGES_DIR, name, 'package.json')))
  .filter((name) => only.length === 0 || only.includes(name))
  .sort();

if (packages.length === 0) {
  console.error(
    only.length > 0
      ? `No package named ${only.join(', ')} under packages/.`
      : 'No packages found under packages/.',
  );
  process.exit(2);
}

type Step = { label: string; cmd: string[] };

let failed = false;
for (const name of packages) {
  const cwd = join(PACKAGES_DIR, name);
  const steps: Step[] = [
    { label: 'typecheck', cmd: [TSC, '-p', 'tsconfig.json'] },
    { label: 'test', cmd: ['bun', 'test'] },
  ];
  if (build) {
    steps.push({ label: 'build', cmd: [TSC, '-p', 'tsconfig.build.json'] });
  }
  for (const step of steps) {
    const started = performance.now();
    const result = Bun.spawnSync(step.cmd, {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const ms = Math.round(performance.now() - started);
    const output = `${result.stdout.toString()}${result.stderr.toString()}`;
    if (result.exitCode === 0) {
      const summary =
        step.label === 'test'
          ? (output.match(/^\s*(\d+ pass)/m)?.[1] ?? 'ok')
          : 'ok';
      console.log(`✓ ${name} ${step.label} (${summary}, ${ms}ms)`);
      continue;
    }
    failed = true;
    console.log(`✗ ${name} ${step.label} (${ms}ms)`);
    console.log(output.trim());
  }
}

process.exit(failed ? 1 : 0);
