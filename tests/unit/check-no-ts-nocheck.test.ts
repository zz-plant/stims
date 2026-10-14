/**
 * Behavioural coverage for the whole-file type-check suppression guard.
 *
 * It used to scan only .ts/.tsx/.js/.jsx, so the directive in one of the
 * .mjs build scripts under scripts/ passed the gate. These run the actual
 * script against a fixture tree rather than re-implementing its matching.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Spliced so this file does not trip the guard it tests.
const DIRECTIVE = '@ts-' + 'nocheck';
const GUARD = join(
  import.meta.dir,
  '..',
  '..',
  'scripts',
  'check-no-ts-nocheck.ts',
);

function runGuard(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'no-ts-nocheck-'));
  try {
    for (const dir of ['src', 'scripts', 'tests']) {
      mkdirSync(join(root, dir));
    }
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(root, name), content);
    }
    const result = Bun.spawnSync({ cmd: ['bun', 'run', GUARD], cwd: root });
    return {
      code: result.exitCode ?? 1,
      output:
        new TextDecoder().decode(result.stdout) +
        new TextDecoder().decode(result.stderr),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('check:no-ts-nocheck', () => {
  for (const extension of [
    'ts',
    'tsx',
    'mts',
    'cts',
    'js',
    'jsx',
    'mjs',
    'cjs',
  ]) {
    test(`rejects the directive in a .${extension} file`, () => {
      const file = `scripts/build.${extension}`;
      const { code, output } = runGuard({
        [file]: `// ${DIRECTIVE}\nexport {};\n`,
      });
      expect(code).toBe(1);
      expect(output).toContain(`${file}:1:`);
    });
  }

  test('passes a tree that only mentions the directive in prose', () => {
    const { code } = runGuard({
      'src/rule.mjs': `/** The ${DIRECTIVE} rule is enforced. */\n`,
    });
    expect(code).toBe(0);
  });
});
