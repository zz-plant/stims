import { describe, expect, test } from 'bun:test';
import toyManifest from '../assets/js/data/toy-manifest.ts';

describe('registered toy modules', () => {
  test('every module entry imports cleanly and exposes start()', async () => {
    for (const entry of toyManifest) {
      if (entry.type !== 'module') continue;

      const module = await import(
        new URL(`../${entry.module}`, import.meta.url).href
      );
      expect(typeof module.start).toBe('function');
    }
  });
});
