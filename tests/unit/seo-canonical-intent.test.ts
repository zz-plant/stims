import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const readRepoFile = (relativePath: string) =>
  readFileSync(join(import.meta.dir, '..', '..', relativePath), 'utf8');

describe('Search Console canonical intent', () => {
  test('documents the milkdrop alias as a noindex compatibility redirect to the root canonical route', () => {
    const aliasHtml = readRepoFile('milkdrop/index.html');

    expect(aliasHtml).toContain(
      '<meta name="robots" content="noindex,follow" />',
    );
    expect(aliasHtml).toContain(
      '<link rel="canonical" href="https://toil.fyi/" />',
    );
    // The comment text and check-seo.ts's own console message used to be
    // asserted here too. Rewording either changed nothing a crawler sees; the
    // meta tags above are the shipped contract.
  });

  test('keeps the homepage crawl path on canonical URLs instead of the milkdrop alias', () => {
    const homepage = readRepoFile('index.html');

    expect(homepage).toContain('aria-label="Crawlable site links"');
    expect(homepage).toContain('href="/"');
    expect(homepage).toContain('href="/performance/"');
    expect(homepage).not.toContain('href="/milkdrop/"');
  });
});
