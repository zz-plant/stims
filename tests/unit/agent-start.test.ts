import { expect, test } from 'bun:test';
import { formatSession } from '../../scripts/agent-start.ts';

test('warns when the shared main checkout has uncommitted work', () => {
  const text = formatSession({
    cwd: '/repo',
    branch: 'feat/x',
    head: 'abc1234',
    isMainCheckout: true,
    dirty: [' M src/a.ts', '?? src/b.ts'],
    worktrees: 66,
    mergedWorktrees: 9,
  }).join('\n');

  expect(text).toContain('main checkout — SHARED with other sessions');
  expect(text).toContain('dirty:  2 file(s)');
  expect(text).toContain('9 merged and pruneable');
  expect(text).toContain('worktree:new');
  expect(text).toContain('⚠ This is the main checkout');
});

test('does not warn in a clean worktree', () => {
  const text = formatSession({
    cwd: '/worktrees/repo-fix',
    branch: 'fix/x',
    head: 'def5678',
    isMainCheckout: false,
    dirty: [],
    worktrees: 66,
    mergedWorktrees: 0,
  }).join('\n');

  expect(text).toContain('role:   worktree');
  expect(text).toContain('dirty:  none');
  expect(text).not.toContain('⚠');
  expect(text).not.toContain('worktree:prune');
});
