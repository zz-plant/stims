import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('site:build delegates deploy packaging to the site build script', async () => {
  const packageDocument = JSON.parse(
    await readFile('package.json', 'utf8'),
  ) as { scripts?: Record<string, string> };

  expect(packageDocument.scripts?.['site:build']).toBe(
    'bun run scripts/build-site.mjs',
  );
});

test('site build overlaps the independent app and Worker compilers', async () => {
  const buildScript = await readFile('scripts/build-site.mjs', 'utf8');

  expect(buildScript).toContain('await Promise.allSettled([');
});
