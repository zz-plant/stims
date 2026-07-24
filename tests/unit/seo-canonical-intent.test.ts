import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const readRepoFile = (relativePath: string) =>
  readFileSync(join(import.meta.dir, '..', '..', relativePath), 'utf8');

describe('Search Console canonical intent', () => {
  test('documents the milkdrop alias as a noindex compatibility redirect to the root canonical route', () => {
    const aliasHtml = readRepoFile('milkdrop/index.html');
    const seoCheck = readRepoFile('scripts/check-seo.ts');

    expect(aliasHtml).toContain(
      '<meta name="robots" content="noindex,follow" />',
    );
    expect(aliasHtml).toContain(
      '<link rel="canonical" href="https://toil.fyi/" />',
    );
    expect(aliasHtml).toContain(
      'Compatibility alias for old /milkdrop/ links.',
    );
    expect(seoCheck).toContain(
      'Milkdrop alias is a noindex canonical redirect',
    );
  });

  test('keeps the homepage crawl path on canonical URLs instead of the milkdrop alias', () => {
    const homepage = readRepoFile('index.html');
    const seoCheck = readRepoFile('scripts/check-seo.ts');

    expect(homepage).toContain('aria-label="Crawlable site links"');
    expect(homepage).toContain('href="/"');
    expect(homepage).toContain('href="/performance/"');
    expect(homepage).not.toContain('href="/milkdrop/"');
    expect(seoCheck).toContain('Homepage exposes crawlable canonical links');
  });
});
