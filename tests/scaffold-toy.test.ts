import { describe, expect, mock, test } from 'bun:test';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scaffoldToy } from '../scripts/scaffold-toy.ts';

async function createTempRepo() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'toy-scaffold-'));

  await fs.mkdir(path.join(root, 'assets/data'), { recursive: true });
  await fs.writeFile(path.join(root, 'assets/data/toys.json'), '[]\n');

  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'docs/TOY_SCRIPT_INDEX.md'),
    `# Toy and Visualizer Script Index

## Query-driven toys (\`toy.html\`)
| Slug | Entry module | How it loads |
| --- | --- | --- |

## Standalone HTML entry points
`,
  );

  await fs.mkdir(path.join(root, 'tests'), { recursive: true });
  await fs.mkdir(path.join(root, 'toys'), { recursive: true });

  return root;
}

describe('scaffold-toy CLI helpers', () => {
  test('writes module, metadata, index row, and test file when requested', async () => {
    const root = await createTempRepo();
    const slug = 'ripple-orb';
    const title = 'Ripple Orb';
    const description = 'Gentle rippling spheres.';

    const log = mock((...args: unknown[]) => {
      void args;
    });
    const originalConsoleLog = console.log;
    console.log = (...args) => {
      log(...args);
    };

    await scaffoldToy({
      slug,
      title,
      description,
      type: 'module',
      createTest: true,
      root,
    });

    const modulePath = path.join(root, 'assets/js/toys', `${slug}.ts`);
    const moduleContents = await fs.readFile(modulePath, 'utf8');
    expect(moduleContents).toContain('export const start: ToyStartFunction');
    expect(moduleContents).toContain('import WebToy');
    expect(moduleContents).toContain('toy.dispose()');

    const data = await fs.readFile(
      path.join(root, 'assets/data/toys.json'),
      'utf8',
    );
    const entries = JSON.parse(data) as Array<{ slug: string; title: string }>;
    const entry = entries.find((item) => item.slug === slug);
    expect(entry?.title).toBe(title);
    expect(entry).toBeTruthy();

    const index = await fs.readFile(
      path.join(root, 'docs/TOY_SCRIPT_INDEX.md'),
      'utf8',
    );
    expect(index).toContain(`| \`${slug}\``);
    expect(index.indexOf(slug)).toBeLessThan(
      index.indexOf('## Standalone HTML entry points'),
    );

    const testSpec = await fs.readFile(
      path.join(root, 'tests', `${slug}.test.ts`),
      'utf8',
    );
    expect(testSpec).toContain(`describe('${slug} toy scaffold'`);

    console.log = originalConsoleLog;
  });

  test('throws when a duplicate slug exists in metadata', async () => {
    const root = await createTempRepo();
    await fs.writeFile(
      path.join(root, 'assets/data/toys.json'),
      JSON.stringify(
        [
          {
            slug: 'dupe',
            title: 'Existing',
            description: 'Dupe',
            module: 'assets/js/toys/dupe.ts',
            type: 'module',
            requiresWebGPU: false,
            capabilities: {
              microphone: true,
              demoAudio: true,
              motion: false,
            },
          },
        ],
        null,
        2,
      ),
    );

    await expect(
      scaffoldToy({
        slug: 'dupe',
        title: 'Duplicate',
        description: 'Existing slug',
        type: 'module',
        createTest: false,
        root,
      }),
    ).rejects.toThrow(/already exists/);
  });

  test('appends metadata to YAML registry when JSON is absent', async () => {
    const root = await createTempRepo();
    const slug = 'yaml-ripple';

    await fs.rm(path.join(root, 'assets/data/toys.json'));
    await fs.writeFile(path.join(root, 'assets/data/toys.yaml'), '[]\n');

    await scaffoldToy({
      slug,
      title: 'YAML Ripple',
      description: 'YAML-backed toy metadata.',
      type: 'module',
      createTest: false,
      root,
    });

    const yamlData = await fs.readFile(
      path.join(root, 'assets/data/toys.yaml'),
      'utf8',
    );
    expect(yamlData).toContain(`slug: ${slug}`);
    expect(yamlData).toContain('title: YAML Ripple');
  });

  test('creates a standalone HTML entry point and validates metadata', async () => {
    const root = await createTempRepo();
    const slug = 'portal-frame';
    const title = 'Portal Frame';
    const description = 'Standalone page placeholder.';

    await scaffoldToy({
      slug,
      title,
      description,
      type: 'page',
      createTest: false,
      root,
    });

    const htmlPath = path.join(root, 'toys', `${slug}.html`);
    const html = await fs.readFile(htmlPath, 'utf8');
    expect(html).toContain('<title>Portal Frame</title>');
    expect(html).toContain('standalone toy page');

    const raw = await fs.readFile(
      path.join(root, 'assets/data/toys.json'),
      'utf8',
    );
    const data = JSON.parse(raw) as Array<{
      slug: string;
      type: string;
      module: string;
    }>;
    const entry = data.find((item) => item.slug === slug) ?? null;
    expect(entry).toBeTruthy();
    if (!entry) {
      throw new Error('Scaffolded entry was not added to metadata.');
    }
    expect(entry.type).toBe('page');
    expect(entry.module).toBe(`toys/${slug}.html`);
  });
});
