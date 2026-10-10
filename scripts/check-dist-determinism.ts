/**
 * Builds a package twice from clean and fails if the two dists differ — the
 * published tarball should be a function of the source, not of the machine
 * that built it. Wired into publish-packages.yml ahead of npm pack, and not
 * part of the quality gate because it pays for two full tsc runs per package.
 *
 * Uses each package's own `build` script (what publishing runs), cleans
 * `dist/` between builds, and snapshots both outputs to a temporary directory
 * before comparing byte for byte. Non-determinism in a sourceMap or
 * declarationMap shows up here rather than as a tarball that differs from the
 * last release in ways no changelog explains.
 *
 *   bun run check:dist-determinism                # every standalone package
 *   bun run check:dist-determinism -- flash-guard # one package
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { packageNames } from './package-manifest.ts';

const ROOT = process.cwd();

/**
 * Relative file paths where the two directory trees differ: a file present in
 * one and missing in the other, or present in both with different bytes.
 * Directory names and empty directories are ignored — only file content is
 * published.
 */
export function compareTrees(dirA: string, dirB: string): string[] {
  const filesOf = (root: string): Map<string, Buffer> => {
    const files = new Map<string, Buffer>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        files.set(
          relative(root, full).split('\\').join('/'),
          readFileSync(full),
        );
      }
    };
    if (existsSync(root)) walk(root);
    return files;
  };

  const a = filesOf(dirA);
  const b = filesOf(dirB);
  const differences: string[] = [];
  for (const [path, bytesA] of a) {
    const bytesB = b.get(path);
    if (!bytesB) differences.push(`${path}: only in the first build`);
    else if (!bytesA.equals(bytesB)) differences.push(`${path}: bytes differ`);
  }
  for (const path of b.keys()) {
    if (!a.has(path)) differences.push(`${path}: only in the second build`);
  }
  return differences.sort();
}

async function buildPackage(name: string): Promise<string[]> {
  const packageDir = join(ROOT, 'packages', name);
  const distDir = join(packageDir, 'dist');
  if (!existsSync(join(packageDir, 'tsconfig.build.json'))) {
    return [`${name}: no tsconfig.build.json — nothing to check`];
  }

  const tempRoot = join(
    tmpdir(),
    `stims-dist-determinism-${process.pid}-${Date.now()}`,
  );
  try {
    const snapshots: string[] = [];
    for (let round = 0; round < 2; round++) {
      rmSync(distDir, { recursive: true, force: true });
      const build = Bun.spawnSync(['bun', 'run', 'build'], {
        cwd: packageDir,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      if (build.exitCode !== 0) {
        return [
          `${name}: build failed on round ${round + 1}\n` +
            `${build.stderr.toString().trim()}`,
        ];
      }
      if (!existsSync(distDir)) {
        return [`${name}: build exited 0 but produced no dist/`];
      }
      const snapshot = join(tempRoot, `build-${round}`);
      mkdirSync(snapshot, { recursive: true });
      cpSync(distDir, snapshot, { recursive: true });
      snapshots.push(snapshot);
    }
    return compareTrees(snapshots[0], snapshots[1]).map(
      (difference) => `${name}: ${difference}`,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const names = args.length > 0 ? args : packageNames('standalone');

  let failed = false;
  for (const name of names) {
    const started = performance.now();
    const differences = await buildPackage(name);
    const ms = Math.round(performance.now() - started);
    if (differences.length === 0) {
      console.log(`✓ ${name} builds deterministically (${ms}ms)`);
      continue;
    }
    failed = true;
    console.log(`✗ ${name} builds differ between clean builds (${ms}ms)`);
    for (const difference of differences) console.log(`  ${difference}`);
  }
  process.exit(failed ? 1 : 0);
}

if (import.meta.main) {
  await main();
}
