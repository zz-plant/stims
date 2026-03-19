import { readFile } from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const publicDir = path.join(rootDir, 'public');

type CheckResult = {
  name: string;
  passed: boolean;
  details?: string;
};

const requiredInIndexHtml = [
  '<link rel="canonical" href="https://no.toil.fyi/" />',
  '<meta property="og:title"',
  '<meta property="og:image"',
  '<meta name="twitter:card" content="summary_large_image"',
  '<script type="application/ld+json">',
];

const run = async () => {
  const results: CheckResult[] = [];

  const homepage = await readFile(path.join(rootDir, 'index.html'), 'utf8');
  for (const snippet of requiredInIndexHtml) {
    results.push({
      name: `Homepage contains ${snippet}`,
      passed: homepage.includes(snippet),
      details: 'index.html',
    });
  }

  const robots = await readFile(path.join(publicDir, 'robots.txt'), 'utf8');
  results.push({
    name: 'robots.txt references sitemap index',
    passed: robots.includes('Sitemap: https://no.toil.fyi/sitemap.xml'),
    details: 'public/robots.txt',
  });

  const sitemapIndex = await readFile(
    path.join(publicDir, 'sitemap.xml'),
    'utf8',
  );
  results.push({
    name: 'Sitemap index contains sitemap-1.xml location',
    passed: sitemapIndex.includes(
      '<loc>https://no.toil.fyi/sitemap-1.xml</loc>',
    ),
    details: 'public/sitemap.xml',
  });

  const sitemapChunk = await readFile(
    path.join(publicDir, 'sitemap-1.xml'),
    'utf8',
  );
  const hasUrlLastmod =
    sitemapChunk.includes('<loc>https://no.toil.fyi/toy.html</loc>') &&
    sitemapChunk.includes('<lastmod>');
  results.push({
    name: 'Sitemap chunk includes `toy.html` entry',
    passed: hasUrlLastmod,
    details: 'public/sitemap-1.xml',
  });

  results.push({
    name: 'Sitemap chunk includes image sitemap namespace',
    passed: sitemapChunk.includes(
      'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"',
    ),
    details: 'public/sitemap-1.xml',
  });

  results.push({
    name: 'Sitemap chunk includes OG image entry for the launch page',
    passed:
      sitemapChunk.includes('<loc>https://no.toil.fyi/toy.html</loc>') &&
      sitemapChunk.includes(
        '<image:loc>https://no.toil.fyi/og/milkdrop.svg</image:loc>',
      ),
    details: 'public/sitemap-1.xml',
  });

  const failures = results.filter((result) => !result.passed);
  for (const result of results) {
    const icon = result.passed ? '✅' : '❌';
    const suffix = result.details ? ` (${result.details})` : '';
    console.log(`${icon} ${result.name}${suffix}`);
  }

  if (failures.length > 0) {
    throw new Error(`SEO checks failed: ${failures.length} issue(s) detected.`);
  }
};

await run();
