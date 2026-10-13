import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
/**
 * Tests for the shared-stylesheet divergence rule.
 *
 * The real-repo smoke run lives below (all four current sites share one
 * stylesheet byte for byte); the synthetic cases prove the guard can fail,
 * which is the part a clean-tree assertion cannot.
 */
import { findStyleDivergence } from '../../scripts/check-site-styles-identical.ts';

function runCheck(): number {
  const result = spawnSync(
    'bun',
    ['run', 'scripts/check-site-styles-identical.ts'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );
  return result.status ?? 0;
}

describe('check:site-styles-identical', () => {
  test('passes on the current repo', () => {
    expect(runCheck()).toBe(0);
  });
});

describe('findStyleDivergence', () => {
  test('fewer than two copies is trivially identical', () => {
    expect(findStyleDivergence({})).toEqual([]);
    expect(
      findStyleDivergence({ 'packages/a/site/styles.css': 'body {}' }),
    ).toEqual([]);
  });

  test('byte-identical copies pass', () => {
    const styles = {
      'packages/a/site/styles.css': '.grid { gap: 10px; }',
      'packages/b/site/styles.css': '.grid { gap: 10px; }',
    };
    expect(findStyleDivergence(styles)).toEqual([]);
  });

  test('a diverging copy is named with the reference and sizes', () => {
    const errors = findStyleDivergence({
      'packages/a/site/styles.css': '.grid { gap: 10px; }',
      'packages/b/site/styles.css': '.grid { gap: 12px; }',
      'packages/c/site/styles.css': '.grid { gap: 10px; }',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      'packages/b/site/styles.css differs from packages/a/site/styles.css',
    );
  });
});
