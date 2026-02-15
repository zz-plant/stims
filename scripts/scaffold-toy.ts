import fs from 'node:fs/promises';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  type ToyManifest,
  toyManifestSchema,
} from '../assets/js/data/toy-schema.ts';

type ToyType = 'module' | 'page';

type ScaffoldOptions = {
  slug?: string;
  title?: string;
  description?: string;
  type?: ToyType;
  createTest?: boolean;
  createSpec?: boolean;
  root?: string;
};

type ScaffoldToyOptions = {
  slug: string;
  title: string;
  description: string;
  type?: ToyType;
  createTest?: boolean;
  root?: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const rl = createInterface({ input, output });

  try {
    const slug = parsed.slug ?? (await promptSlug(rl, parsed.root));
    const title = parsed.title ?? (await promptTitle(rl, slug));
    const type = resolveType(parsed.type) ?? (await promptType(rl));
    const description =
      parsed.description ??
      ((
        await rl.question(`Short description [Add description for ${title}]: `)
      ).trim() ||
        `Add description for ${title}.`);
    const shouldCreateTest =
      parsed.createTest ??
      parsed.createSpec ??
      (await promptBoolean(
        rl,
        'Create a Bun spec to assert the module exports start? (y/N) ',
        false,
      ));

    await scaffoldToy({
      slug,
      title,
      description,
      type,
      createTest: shouldCreateTest,
      root: parsed.root,
    });

    console.log(`\nCreated scaffold for ${slug}.`);
    if (type === 'module') {
      console.log(
        '- Module:',
        path.relative(
          parsed.root ?? repoRoot,
          toyModulePath(slug, parsed.root),
        ),
      );
    } else {
      console.log(
        '- HTML entry:',
        path.relative(parsed.root ?? repoRoot, toyHtmlPath(slug, parsed.root)),
      );
    }
    console.log('- Metadata: assets/data/toys.json');
    console.log('- Index: docs/TOY_SCRIPT_INDEX.md');
    if (shouldCreateTest && type === 'module') {
      console.log(`- Test: tests/${testFileName(slug)}`);
    }
  } catch (error) {
    console.error(
      '\nScaffold failed:',
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}

export async function scaffoldToy({
  slug,
  title,
  description,
  type = 'module',
  createTest = false,
  root = repoRoot,
}: ScaffoldToyOptions) {
  await ensureToysDataValid(root);

  if (await fileExists(toyModulePath(slug, root))) {
    throw new Error(`A toy module already exists for slug "${slug}".`);
  }

  if (type === 'page' && (await fileExists(toyHtmlPath(slug, root)))) {
    throw new Error(
      `HTML entry point ${toyHtmlPath(slug, root)} already exists.`,
    );
  }

  await createToyModule(slug, type, root);
  await ensureEntryPoint(slug, type, title, root);
  await appendToyMetadata(slug, title, description, type, root);
  await validateMetadataEntry(slug, title, description, type, root);
  await updateToyIndex(slug, type, root);

  if (createTest && type === 'module') {
    await createTestSpec(slug, root);
  }
}

function toyModulePath(slug: string, root = repoRoot) {
  return path.join(root, 'assets/js/toys', `${slug}.ts`);
}

function toyHtmlPath(slug: string, root = repoRoot) {
  return path.join(root, 'toys', `${slug}.html`);
}

function testFileName(slug: string) {
  return `${slug}.test.ts`;
}

function parseArgs(args: string[]): ScaffoldOptions {
  const options: ScaffoldOptions = {};

  for (let i = 0; i < args.length; i += 1) {
    const current = args[i];
    const next = args[i + 1];

    switch (current) {
      case '--slug':
      case '-s':
        options.slug = next;
        i += 1;
        break;
      case '--title':
      case '-t':
        options.title = next;
        i += 1;
        break;
      case '--type':
        options.type = next as ToyType;
        i += 1;
        break;
      case '--description':
      case '-d':
        options.description = next;
        i += 1;
        break;
      case '--with-test':
        options.createTest = true;
        break;
      case '--with-spec':
        options.createSpec = true;
        break;
      case '--root':
        options.root = next ? path.resolve(next) : undefined;
        i += 1;
        break;
      default:
        break;
    }
  }

  return options;
}

async function ensureToysDataValid(root = repoRoot) {
  const entries = await loadToysData(root);
  const parsed = toyManifestSchema.parse(entries);
  return parsed;
}

function resolveType(type?: string): ToyType | null {
  if (!type) return null;
  if (type === 'module' || type === 'page') return type;
  const normalized = type.toLowerCase();
  if (normalized === 'm') return 'module';
  if (normalized === 'p') return 'page';
  throw new Error('Toy type must be "module" or "page".');
}

async function promptSlug(
  rl: ReturnType<typeof createInterface>,
  root = repoRoot,
) {
  const raw = (
    await rl.question('Toy slug (kebab-case, e.g., ripple-orb): ')
  ).trim();
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/(^-|-$)/g, '');

  if (!slug) {
    throw new Error('A slug is required.');
  }

  if (await fileExists(toyModulePath(slug, root))) {
    throw new Error(`A toy module already exists for slug "${slug}".`);
  }

  const toysData = await loadToysData(root);
  if (toysData.some((entry) => entry.slug === slug)) {
    throw new Error(`Slug "${slug}" already exists in assets/data/toys.json.`);
  }

  return slug;
}

async function promptTitle(
  rl: ReturnType<typeof createInterface>,
  slug: string,
) {
  const suggested = slug
    .split('-')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');

  const title =
    (await rl.question(`Display title [${suggested}]: `)).trim() || suggested;

  if (!title) {
    throw new Error('A title is required.');
  }

  return title;
}

async function promptType(
  rl: ReturnType<typeof createInterface>,
): Promise<ToyType> {
  const rawType = (await rl.question('Toy type (module/page) [module]: '))
    .trim()
    .toLowerCase();

  if (!rawType || rawType === 'module' || rawType === 'm') return 'module';
  if (rawType === 'page' || rawType === 'p') return 'page';

  throw new Error('Toy type must be "module" or "page".');
}

async function promptBoolean(
  rl: ReturnType<typeof createInterface>,
  question: string,
  defaultValue: boolean,
) {
  const reply = (await rl.question(question)).trim().toLowerCase();
  if (!reply) return defaultValue;
  return reply.startsWith('y');
}

async function loadToysData(root = repoRoot) {
  const dataPath = path.join(root, 'assets/data/toys.json');
  const source = await fs.readFile(dataPath, 'utf8');
  const entries = JSON.parse(source);

  if (!Array.isArray(entries)) {
    throw new Error('Expected assets/data/toys.json to export an array.');
  }

  return entries as ToyManifest;
}

async function ensureEntryPoint(
  slug: string,
  type: ToyType,
  title: string,
  root = repoRoot,
) {
  if (type !== 'page') return;

  const htmlPath = toyHtmlPath(slug, root);
  if (await fileExists(htmlPath)) return;
  await fs.mkdir(path.dirname(htmlPath), { recursive: true });

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${title}</title>
    <link rel="stylesheet" href="../assets/css/base.css" />
  </head>
  <body>
    <a href="../index.html" class="home-link">Back to Library</a>
    <main class="toy-canvas" style="display: grid; place-items: center; min-height: 100vh;">
      <p style="text-align: center; max-width: 38rem;">
        Replace this placeholder with your experience for <strong>${title}</strong>.
        Mount canvases or DOM elements here for a standalone toy page.
      </p>
    </main>
  </body>
</html>
`;

  await fs.writeFile(htmlPath, html, 'utf8');
}

async function createToyModule(slug: string, type: ToyType, root = repoRoot) {
  if (type === 'page') return;
  const modulePath = toyModulePath(slug, root);
  await fs.mkdir(path.dirname(modulePath), { recursive: true });

  const contents = moduleTemplate();
  await fs.writeFile(modulePath, contents, 'utf8');
}

async function appendToyMetadata(
  slug: string,
  title: string,
  description: string,
  type: ToyType,
  root = repoRoot,
) {
  const dataPath = path.join(root, 'assets/data/toys.json');
  const current = await loadToysData(root);

  if (current.some((entry) => entry.slug === slug)) {
    throw new Error(`Slug "${slug}" already exists in assets/data/toys.json.`);
  }

  const newEntry = {
    slug,
    title,
    description,
    module: type === 'page' ? `toys/${slug}.html` : `assets/js/toys/${slug}.ts`,
    type,
    requiresWebGPU: false,
    capabilities: {
      microphone: true,
      demoAudio: true,
      motion: false,
    },
  };

  const updated = [...current, newEntry];
  await fs.writeFile(dataPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
}

async function validateMetadataEntry(
  slug: string,
  title: string,
  description: string,
  type: ToyType,
  root = repoRoot,
) {
  const entries = await ensureToysDataValid(root);
  const entry = entries.find((item) => item.slug === slug);

  if (!entry) {
    throw new Error(`Failed to register ${slug} in assets/data/toys.json.`);
  }

  const expectedModule =
    type === 'page' ? `toys/${slug}.html` : `assets/js/toys/${slug}.ts`;
  if (entry.module !== expectedModule) {
    throw new Error(`Module path for ${slug} must be ${expectedModule}.`);
  }

  if (entry.type !== type) {
    throw new Error(`Metadata type for ${slug} should be "${type}".`);
  }

  if (!entry.description || !entry.title) {
    throw new Error(
      `Metadata for ${slug} must include a title and description.`,
    );
  }

  if (entry.title !== title || entry.description !== description) {
    console.warn(
      'Metadata text differs from scaffold input; keeping file values.',
    );
  }
}

async function updateToyIndex(slug: string, type: ToyType, root = repoRoot) {
  const indexPath = path.join(root, 'docs/TOY_SCRIPT_INDEX.md');
  const current = await fs.readFile(indexPath, 'utf8');

  const row =
    type === 'page'
      ? `| \`${slug}\` | \`toys/${slug}.html\` | Standalone HTML page. |`
      : `| \`${slug}\` | \`assets/js/toys/${slug}.ts\` | Direct module; load with \`toy.html?toy=${slug}\`. |`;

  if (current.includes(row)) return;
  if (current.includes(`| \`${slug}\``)) {
    throw new Error(
      `Slug "${slug}" already exists in docs/TOY_SCRIPT_INDEX.md.`,
    );
  }

  const marker = '## Standalone HTML entry points';
  const markerIndex = current.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(
      'Could not find insertion point in docs/TOY_SCRIPT_INDEX.md.',
    );
  }

  const before = current.slice(0, markerIndex).replace(/\s*$/, '');
  const after = current.slice(markerIndex);
  const updated = `${before}\n${row}\n\n${after}`;

  await fs.writeFile(indexPath, updated, 'utf8');
}

async function createTestSpec(slug: string, root = repoRoot) {
  const testsDir = path.join(root, 'tests');
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
  return `import type { ToyStartFunction } from '../core/toy-interface';
import WebToy from '../core/web-toy';

export const start: ToyStartFunction = async ({ container, canvas } = {}) => {
  const toy = new WebToy({
    container,
    canvas,
    cameraOptions: { position: { x: 0, y: 0, z: 40 } },
  });

  let frameId = 0;
  let disposed = false;

  const animate = (time: number) => {
    if (disposed || !toy.renderer) {
      return;
    }

    void time;
    toy.render();
    frameId = requestAnimationFrame(animate);
  };

  frameId = requestAnimationFrame(animate);

  return {
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      toy.dispose();
    },
  };
};
`;
}

const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (argvPath && import.meta.url === pathToFileURL(argvPath).href) {
  await main();
}
