import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Workspace shell stage tool interaction regression', () => {
  test('keeps the global tools backdrop off the stage-anchored editor and inspector', () => {
    const source = readFileSync(
      join(import.meta.dir, '..', 'assets', 'js', 'frontend', 'App.tsx'),
      'utf8',
    );

    expect(source).toMatch(
      /const stageAnchoredToolOpen =[\s\S]*?routeState\.panel === 'editor' \|\| routeState\.panel === 'inspector'/u,
    );
    expect(source).toMatch(
      /\{!stageAnchoredToolOpen \? \(\s*<button[\s\S]*?className="stims-shell__sheet-backdrop"/u,
    );
  });
});
