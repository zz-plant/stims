import fs from 'node:fs/promises';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

type ToyType = 'module' | 'iframe';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

async function main() {
  const rl = createInterface({ input, output });

  try {
    const slug = await promptSlug(rl);
    const title = await promptTitle(rl, slug);
    const type = await promptType(rl);
    const shouldCreateTest = await promptBoolean(rl, 'Create a Bun spec to assert the module exports start? (y/N) ', false);

    await createToyModule(slug, title, type);
    await appendToyMetadata(slug, title, type);
    await updateToyIndex(slug, type);

    if (shouldCreateTest) {
      await createTestSpec(slug);
    }

    console.log(`\nCreated scaffold for ${slug}.`);
    console.log('- Module:', path.relative(repoRoot, toyModulePath(slug)));
    console.log('- Metadata: assets/js/toys-data.js');
    console.log('- Index: docs/TOY_SCRIPT_INDEX.md');
    if (shouldCreateTest) {
      console.log('- Test: tests/' + testFileName(slug));
    }
  } catch (error) {
    console.error('\nScaffold failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}

function toyModulePath(slug: string) {
  return path.join(repoRoot, 'assets/js/toys', `${slug}.ts`);
}

function testFileName(slug: string) {
  return `${slug}.test.ts`;
}

async function promptSlug(rl: ReturnType<typeof createInterface>) {
  const raw = (await rl.question('Toy slug (kebab-case, e.g., ripple-orb): ')).trim();
  const slug = raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/(^-|-$)/g, '');

  if (!slug) {
    throw new Error('A slug is required.');
  }

  if (await fileExists(toyModulePath(slug))) {
    throw new Error(`A toy module already exists for slug "${slug}".`);
  }

  const toysDataPath = path.join(repoRoot, 'assets/js/toys-data.js');
  const toysData = await fs.readFile(toysDataPath, 'utf8');
  if (toysData.includes(`slug: '${slug}'`)) {
    throw new Error(`Slug "${slug}" already exists in assets/js/toys-data.js.`);
  }

  return slug;
}

async function promptTitle(rl: ReturnType<typeof createInterface>, slug: string) {
  const suggested = slug
    .split('-')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');

  const title = (await rl.question(`Display title [${suggested}]: `)).trim() || suggested;

  if (!title) {
    throw new Error('A title is required.');
  }

  return title;
}

async function promptType(rl: ReturnType<typeof createInterface>): Promise<ToyType> {
  const rawType = (await rl.question('Toy type (module/iframe) [module]: ')).trim().toLowerCase();

  if (!rawType || rawType === 'module' || rawType === 'm') return 'module';
  if (rawType === 'iframe' || rawType === 'i') return 'iframe';

  throw new Error('Toy type must be "module" or "iframe".');
}

async function promptBoolean(rl: ReturnType<typeof createInterface>, question: string, defaultValue: boolean) {
  const reply = (await rl.question(question)).trim().toLowerCase();
  if (!reply) return defaultValue;
  return reply.startsWith('y');
}

async function createToyModule(slug: string, title: string, type: ToyType) {
  const modulePath = toyModulePath(slug);
  await fs.mkdir(path.dirname(modulePath), { recursive: true });

  const contents = type === 'iframe' ? iframeTemplate(slug, title) : moduleTemplate();
  await fs.writeFile(modulePath, contents, 'utf8');
}

async function appendToyMetadata(slug: string, title: string, type: ToyType) {
  const dataPath = path.join(repoRoot, 'assets/js/toys-data.js');
  const current = await fs.readFile(dataPath, 'utf8');

  const newEntry = [
    '  {',
    `    slug: '${slug}',`,
    `    title: '${title.replace(/'/g, "\\'")}',`,
    "    description:",
    `      'Add description for ${title.replace(/'/g, "\\'")}.',`,
    `    module: 'assets/js/toys/${slug}.ts',`,
    `    type: '${type}',`,
    '    requiresWebGPU: false,',
    '  },',
  ].join('\n');

  if (!current.includes('];')) {
    throw new Error('Could not find toys array terminator in assets/js/toys-data.js.');
  }

  const updated = current.replace(/\n\];\s*$/, `\n${newEntry}\n];\n`);

  if (updated === current) {
    throw new Error('Failed to update assets/js/toys-data.js with new metadata.');
  }

  await fs.writeFile(dataPath, updated, 'utf8');
}

async function updateToyIndex(slug: string, type: ToyType) {
  const indexPath = path.join(repoRoot, 'docs/TOY_SCRIPT_INDEX.md');
  const current = await fs.readFile(indexPath, 'utf8');

  const row = `| \`${slug}\` | \`assets/js/toys/${slug}.ts\` | ${
    type === 'iframe'
      ? `Iframe wrapper around \`${slug}.html\`.`
      : `Direct module; load with \`toy.html?toy=${slug}\`.`
  } |`;

  if (current.includes(row)) return;
  if (current.includes(`| \`${slug}\``)) {
    throw new Error(`Slug "${slug}" already exists in docs/TOY_SCRIPT_INDEX.md.`);
  }

  const marker = '## Standalone HTML entry points';
  const markerIndex = current.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error('Could not find insertion point in docs/TOY_SCRIPT_INDEX.md.');
  }

  const before = current.slice(0, markerIndex).replace(/\s*$/, '');
  const after = current.slice(markerIndex);
  const updated = `${before}\n${row}\n\n${after}`;

  await fs.writeFile(indexPath, updated, 'utf8');
}

async function createTestSpec(slug: string) {
  const testsDir = path.join(repoRoot, 'tests');
  await fs.mkdir(testsDir, { recursive: true });
  const testPath = path.join(testsDir, testFileName(slug));

  const contents = `import { describe, expect, test } from 'bun:test';\nimport * as toy from '../assets/js/toys/${slug}.ts';\n\ndescribe('${slug} toy scaffold', () => {\n  test('exports a start function', () => {\n    expect(typeof toy.start).toBe('function');\n  });\n});\n`;

  await fs.writeFile(testPath, contents, 'utf8');
}

async function fileExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function moduleTemplate() {
  return `import { initRenderer } from '../core/renderer';\nimport { createAnalyzer } from '../core/audio';\n\nexport async function start({ canvas, audioContext }) {\n  const { renderer, scene, camera, resize } = initRenderer({ canvas, maxPixelRatio: 2 });\n  const analyzer = await createAnalyzer(audioContext);\n\n  function tick(time) {\n    const { frequency, waveform } = analyzer.sample();\n    void frequency;\n    void waveform;\n    void time;\n\n    renderer.render(scene, camera);\n    requestAnimationFrame(tick);\n  }\n\n  resize();\n  requestAnimationFrame(tick);\n\n  return () => {\n    analyzer.dispose?.();\n    renderer.dispose?.();\n  };\n}\n`;
}

function iframeTemplate(slug: string, title: string) {
  return `import { startIframeToy } from './iframe-toy';\n\nexport function start({ container } = {}) {\n  return startIframeToy({\n    container,\n    path: './${slug}.html',\n    title: '${title.replace(/'/g, "\\'")}',\n  });\n}\n`;
}

await main();
