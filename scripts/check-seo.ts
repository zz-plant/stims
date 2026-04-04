import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildSeoArtifacts,
  DEFAULT_BASE_URL,
  GENERATED_OG_DEFAULT_PATH,
  GENERATED_OG_MILKDROP_PATH,
  GENERATED_ROBOTS_PATH,
  GENERATED_SITEMAP_CHUNK_PATH,
  GENERATED_SITEMAP_INDEX_PATH,
} from './generate-seo.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const REGENERATE_COMMAND = 'bun run generate:seo';

type CheckResult = {
  name: string;
  passed: boolean;
  details?: string;
};

const requiredInIndexHtml = [
  '<link rel="canonical" href="https://toil.fyi/" />',
  '<meta property="og:title"',
  '<meta property="og:image"',
  '<meta name="twitter:card" content="summary_large_image"',
  '<script type="application/ld+json">',
];

const normalizeSitemapXml = (value: string) =>
  value.replace(
    /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g,
    '<lastmod>$DATE</lastmod>',
  );

async function compareGeneratedFile(
  rootDir: string,
  relativePath: string,
  expected: string,
  results: CheckResult[],
  {
    normalize,
  }: {
    normalize?: (value: string) => string;
  } = {},
) {
  const actual = await fs.readFile(path.join(rootDir, relativePath), 'utf8');
  const actualValue = normalize ? normalize(actual) : actual;
  const expectedValue = normalize ? normalize(expected) : expected;

  results.push({
    name: `Generated SEO artifact is up to date: ${relativePath}`,
    passed: actualValue === expectedValue,
    details: relativePath,
  });

  return actual;
}

export async function runSeoChecks(rootDir = repoRoot) {
  const results: CheckResult[] = [];

  const homepage = await fs.readFile(path.join(rootDir, 'index.html'), 'utf8');
  for (const snippet of requiredInIndexHtml) {
    results.push({
      name: `Homepage contains ${snippet}`,
      passed: homepage.includes(snippet),
      details: 'index.html',
    });
  }

  const { files } = await buildSeoArtifacts(rootDir, {
    baseUrl: DEFAULT_BASE_URL,
  });
  const expectedFiles = new Map(
    files.map((file) => [file.relativePath, file.contents] as const),
  );

  const robots = await compareGeneratedFile(
    rootDir,
    GENERATED_ROBOTS_PATH,
    expectedFiles.get(GENERATED_ROBOTS_PATH) ?? '',
    results,
  );
  const sitemapIndex = await compareGeneratedFile(
    rootDir,
    GENERATED_SITEMAP_INDEX_PATH,
    expectedFiles.get(GENERATED_SITEMAP_INDEX_PATH) ?? '',
    results,
    { normalize: normalizeSitemapXml },
  );
  const sitemapChunk = await compareGeneratedFile(
    rootDir,
    GENERATED_SITEMAP_CHUNK_PATH,
    expectedFiles.get(GENERATED_SITEMAP_CHUNK_PATH) ?? '',
    results,
    { normalize: normalizeSitemapXml },
  );

  await compareGeneratedFile(
    rootDir,
    GENERATED_OG_DEFAULT_PATH,
    expectedFiles.get(GENERATED_OG_DEFAULT_PATH) ?? '',
    results,
  );
  await compareGeneratedFile(
    rootDir,
    GENERATED_OG_MILKDROP_PATH,
    expectedFiles.get(GENERATED_OG_MILKDROP_PATH) ?? '',
    results,
  );

  results.push({
    name: 'robots.txt references sitemap index',
    passed: robots.includes(`Sitemap: ${DEFAULT_BASE_URL}/sitemap.xml`),
    details: GENERATED_ROBOTS_PATH,
  });

  results.push({
    name: 'Sitemap index contains sitemap-1.xml location',
    passed: sitemapIndex.includes(
      `<loc>${DEFAULT_BASE_URL}/sitemap-1.xml</loc>`,
    ),
    details: GENERATED_SITEMAP_INDEX_PATH,
  });

  results.push({
    name: 'Sitemap chunk includes the canonical home route',
    passed:
      sitemapChunk.includes(`<loc>${DEFAULT_BASE_URL}/</loc>`) &&
      sitemapChunk.includes('<lastmod>'),
    details: GENERATED_SITEMAP_CHUNK_PATH,
  });

  results.push({
    name: 'Sitemap chunk excludes the compatibility alias redirect',
    passed: !sitemapChunk.includes(`<loc>${DEFAULT_BASE_URL}/milkdrop/</loc>`),
    details: GENERATED_SITEMAP_CHUNK_PATH,
  });

  results.push({
    name: 'Sitemap chunk includes image sitemap namespace',
    passed: sitemapChunk.includes(
      'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"',
    ),
    details: GENERATED_SITEMAP_CHUNK_PATH,
  });

  results.push({
    name: 'Sitemap chunk includes canonical OG image metadata for the home route',
    passed:
      sitemapChunk.includes(`<loc>${DEFAULT_BASE_URL}/</loc>`) &&
      sitemapChunk.includes(
        `<image:loc>${DEFAULT_BASE_URL}/og/milkdrop.svg</image:loc>`,
      ) &&
      sitemapChunk.includes(
        '<image:title>MilkDrop Visualizer | Stims</image:title>',
      ),
    details: GENERATED_SITEMAP_CHUNK_PATH,
  });

  return results;
}

async function main() {
  const results = await runSeoChecks();
  const failures = results.filter((result) => !result.passed);

  for (const result of results) {
    const icon = result.passed ? '✅' : '❌';
    const suffix = result.details ? ` (${result.details})` : '';
    console.log(`${icon} ${result.name}${suffix}`);
  }

  if (failures.length > 0) {
    console.error(`Regenerate SEO artifacts with: ${REGENERATE_COMMAND}`);
    process.exitCode = 1;
    throw new Error(`SEO checks failed: ${failures.length} issue(s) detected.`);
  }
}

const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (argvPath && import.meta.url === pathToFileURL(argvPath).href) {
  await main();
}
