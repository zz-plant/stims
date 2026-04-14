import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildSeoArtifacts,
  DEFAULT_BASE_URL,
  GENERATED_ICON_192_PATH,
  GENERATED_ICON_512_PATH,
  GENERATED_ICON_FAVICON_32_PATH,
  GENERATED_ICON_FAVICON_SVG_PATH,
  GENERATED_OG_DEFAULT_PATH,
  GENERATED_OG_DEFAULT_PNG_PATH,
  GENERATED_OG_MILKDROP_PATH,
  GENERATED_OG_MILKDROP_PNG_PATH,
  GENERATED_OG_PERFORMANCE_PATH,
  GENERATED_OG_PERFORMANCE_PNG_PATH,
  GENERATED_ROBOTS_PATH,
  GENERATED_SCREENSHOT_HERO_NARROW_PATH,
  GENERATED_SCREENSHOT_HERO_WIDE_PATH,
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
  '<meta property="og:image" content="https://toil.fyi/og/milkdrop.png" />',
  '<meta property="og:image:type" content="image/png" />',
  '<meta name="twitter:card" content="summary_large_image"',
  '<meta name="twitter:image" content="https://toil.fyi/og/milkdrop.png" />',
  '<script type="application/ld+json">',
];

const requiredInPerformanceHtml = [
  '<link rel="canonical" href="https://toil.fyi/performance/" />',
  '<meta property="og:image" content="https://toil.fyi/og/performance.png" />',
  '<meta property="og:image:type" content="image/png" />',
  '<meta name="twitter:image" content="https://toil.fyi/og/performance.png" />',
];

const normalizeSitemapXml = (value: string) =>
  value.replace(
    /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g,
    '<lastmod>$DATE</lastmod>',
  );

async function compareGeneratedFile(
  rootDir: string,
  relativePath: string,
  expected: string | Uint8Array,
  results: CheckResult[],
  {
    normalize,
  }: {
    normalize?: (value: string) => string;
  } = {},
) {
  const actual = await fs.readFile(path.join(rootDir, relativePath));
  let passed = false;
  let returnValue: string | Buffer = actual;

  if (typeof expected === 'string') {
    const actualText = actual.toString('utf8');
    const expectedText = expected;
    passed =
      (normalize ? normalize(actualText) : actualText) ===
      (normalize ? normalize(expectedText) : expectedText);
    returnValue = actualText;
  } else {
    const expectedBuffer = Buffer.from(expected);
    passed = Buffer.compare(actual, expectedBuffer) === 0;
  }

  results.push({
    name: `Generated SEO artifact is up to date: ${relativePath}`,
    passed,
    details: relativePath,
  });

  return returnValue;
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

  const performancePage = await fs.readFile(
    path.join(rootDir, 'performance/index.html'),
    'utf8',
  );
  for (const snippet of requiredInPerformanceHtml) {
    results.push({
      name: `Performance page contains ${snippet}`,
      passed: performancePage.includes(snippet),
      details: 'performance/index.html',
    });
  }

  const manifestRaw = await fs.readFile(
    path.join(rootDir, 'public/manifest.json'),
    'utf8',
  );
  const manifest = JSON.parse(manifestRaw) as {
    icons?: Array<{ src: string }>;
    screenshots?: Array<{ src: string }>;
  };

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
    GENERATED_OG_DEFAULT_PNG_PATH,
    expectedFiles.get(GENERATED_OG_DEFAULT_PNG_PATH) ?? '',
    results,
  );
  await compareGeneratedFile(
    rootDir,
    GENERATED_OG_MILKDROP_PATH,
    expectedFiles.get(GENERATED_OG_MILKDROP_PATH) ?? '',
    results,
  );
  await compareGeneratedFile(
    rootDir,
    GENERATED_OG_MILKDROP_PNG_PATH,
    expectedFiles.get(GENERATED_OG_MILKDROP_PNG_PATH) ?? '',
    results,
  );
  await compareGeneratedFile(
    rootDir,
    GENERATED_OG_PERFORMANCE_PATH,
    expectedFiles.get(GENERATED_OG_PERFORMANCE_PATH) ?? '',
    results,
  );
  await compareGeneratedFile(
    rootDir,
    GENERATED_OG_PERFORMANCE_PNG_PATH,
    expectedFiles.get(GENERATED_OG_PERFORMANCE_PNG_PATH) ?? '',
    results,
  );
  await compareGeneratedFile(
    rootDir,
    GENERATED_ICON_FAVICON_SVG_PATH,
    expectedFiles.get(GENERATED_ICON_FAVICON_SVG_PATH) ?? '',
    results,
  );
  await compareGeneratedFile(
    rootDir,
    GENERATED_ICON_FAVICON_32_PATH,
    expectedFiles.get(GENERATED_ICON_FAVICON_32_PATH) ?? '',
    results,
  );
  await compareGeneratedFile(
    rootDir,
    GENERATED_ICON_192_PATH,
    expectedFiles.get(GENERATED_ICON_192_PATH) ?? '',
    results,
  );
  await compareGeneratedFile(
    rootDir,
    GENERATED_ICON_512_PATH,
    expectedFiles.get(GENERATED_ICON_512_PATH) ?? '',
    results,
  );
  await compareGeneratedFile(
    rootDir,
    GENERATED_SCREENSHOT_HERO_WIDE_PATH,
    expectedFiles.get(GENERATED_SCREENSHOT_HERO_WIDE_PATH) ?? '',
    results,
  );
  await compareGeneratedFile(
    rootDir,
    GENERATED_SCREENSHOT_HERO_NARROW_PATH,
    expectedFiles.get(GENERATED_SCREENSHOT_HERO_NARROW_PATH) ?? '',
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
        `<image:loc>${DEFAULT_BASE_URL}/og/milkdrop.png</image:loc>`,
      ) &&
      sitemapChunk.includes(
        '<image:title>MilkDrop Visualizer | Stims</image:title>',
      ),
    details: GENERATED_SITEMAP_CHUNK_PATH,
  });

  results.push({
    name: 'Sitemap chunk includes dedicated performance OG image metadata',
    passed:
      sitemapChunk.includes(`<loc>${DEFAULT_BASE_URL}/performance/</loc>`) &&
      sitemapChunk.includes(
        `<image:loc>${DEFAULT_BASE_URL}/og/performance.png</image:loc>`,
      ) &&
      sitemapChunk.includes(
        '<image:title>Compatibility and Performance | Stims</image:title>',
      ),
    details: GENERATED_SITEMAP_CHUNK_PATH,
  });

  results.push({
    name: 'Manifest references generated icon assets',
    passed:
      manifest.icons?.some((icon) => icon.src === '/icons/icon-192.png') ===
        true &&
      manifest.icons?.some((icon) => icon.src === '/icons/icon-512.png') ===
        true,
    details: 'public/manifest.json',
  });

  results.push({
    name: 'Manifest references generated screenshot assets',
    passed:
      manifest.screenshots?.some(
        (screenshot) => screenshot.src === '/screenshots/hero-wide.png',
      ) === true &&
      manifest.screenshots?.some(
        (screenshot) => screenshot.src === '/screenshots/hero-narrow.png',
      ) === true,
    details: 'public/manifest.json',
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
