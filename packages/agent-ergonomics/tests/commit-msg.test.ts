import { describe, expect, test } from 'bun:test';
import { collectIo, resolveConfig, runCommitMsg } from '../src/index.ts';

const config = resolveConfig({
  commitMsg: {
    badSubjects:
      /^(fixes|fixed|fixture|various fixes|certainly this works|hopefully works|hopefully|it works|works now|wip)$/i,
  },
});
async function check(subject: string): Promise<number> {
  return await runCommitMsg(['-'], {
    config,
    cwd: process.cwd(),
    env: {},
    io: collectIo(),
    readStdin: async () => subject,
  });
}

describe('check-commit-msg', () => {
  test('rejects non-descriptive subjects', async () => {
    for (const bad of [
      'fixes',
      'fixed',
      'fixture',
      'Various fixes',
      'certainly this works',
      'hopefully works',
    ]) {
      expect(await check(bad)).toBe(1);
    }
  });

  test('rejects missing conventional-commits prefix', async () => {
    expect(await check('update audio handler')).toBe(1);
    expect(await check('Fix the leak')).toBe(1);
  });

  test('warns but accepts a long subject', async () => {
    // Length is style, not signal — the guard's own docblock records that
    // current practice breaks the ceiling routinely on otherwise-good
    // subjects, which is why CI already waives it. Blocking the commit
    // locally over a few characters, after the message is written, only
    // costs a retype.
    expect(
      await check(
        'fix: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    ).toBe(0);
  });

  test('still rejects a long subject that also breaks a real rule', async () => {
    expect(
      await check(
        'hopefully aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    ).toBe(1);
  });

  test('accepts the subjects git writes itself', async () => {
    expect(
      await check("Merge remote-tracking branch 'origin/main' into fix/x"),
    ).toBe(0);
    expect(await check("Merge branch 'main' into feat/y")).toBe(0);
    expect(await check('Revert "fix(audio): close context on unmount"')).toBe(
      0,
    );
  });

  test('does not let a hand-written subject pass as a merge', async () => {
    expect(await check('Merge stuff')).toBe(1);
    expect(await check('Merged the audio fixes')).toBe(1);
  });

  test('accepts valid conventional commits', async () => {
    expect(await check('fix(audio): close context on unmount')).toBe(0);
    expect(await check('feat: add mobile viewport matrix')).toBe(0);
    expect(await check('refactor(renderer): split warp template')).toBe(0);
    expect(await check('ci: gate shader parity on preset changes')).toBe(0);
  });
});
