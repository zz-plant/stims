import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/**
 * Tests for the byte-for-byte tree comparison used by the build determinism
 * check. The two-build orchestration is not unit-tested (it runs tsc, which
 * the publish workflow exercises for real); these prove the comparison itself
 * names every kind of difference: changed bytes, a file missing from one
 * build, a file only in the other.
 */
import { compareTrees } from '../../scripts/check-dist-determinism.ts';

let root: string;

function makeTree(name: 'a' | 'b', files: Record<string, string>): string {
  const dir = join(root, name);
  for (const [relativePath, content] of Object.entries(files)) {
    const full = join(dir, relativePath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('compareTrees', () => {
  test('identical trees produce no differences', () => {
    root = mkdtempSync(join(tmpdir(), 'stims-compare-'));
    try {
      const files = {
        'index.js': 'export {};',
        'nested/index.d.ts': 'declare const x: 1;',
      };
      expect(compareTrees(makeTree('a', files), makeTree('b', files))).toEqual(
        [],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('changed bytes are named', () => {
    root = mkdtempSync(join(tmpdir(), 'stims-compare-'));
    try {
      const differences = compareTrees(
        makeTree('a', { 'index.js': 'export const x = 1;' }),
        makeTree('b', { 'index.js': 'export const x = 2;' }),
      );
      expect(differences).toEqual(['index.js: bytes differ']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a file missing from one build is named', () => {
    root = mkdtempSync(join(tmpdir(), 'stims-compare-'));
    try {
      const differences = compareTrees(
        makeTree('a', { 'index.js': 'x', 'gone.js': 'y' }),
        makeTree('b', { 'index.js': 'x' }),
      );
      expect(differences).toEqual(['gone.js: only in the first build']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a file only in the second build is named', () => {
    root = mkdtempSync(join(tmpdir(), 'stims-compare-'));
    try {
      const differences = compareTrees(
        makeTree('a', { 'index.js': 'x' }),
        makeTree('b', { 'index.js': 'x', 'new.js': 'y' }),
      );
      expect(differences).toEqual(['new.js: only in the second build']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
