import { describe, expect, mock, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { scaffoldToy } from '../scripts/scaffold-toy.ts';

async function createTempRepo() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'toy-scaffold-'));

  await fs.mkdir(path.join(root, 'assets/js'), { recursive: true });
  await fs.writeFile(path.join(root, 'assets/js/toys-data.js'), 'export default [\n];\n');

  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'docs/TOY_SCRIPT_INDEX.md'),
    `# Toy and Visualizer Script Index

## Query-driven toys (\`toy.html\`)
| Slug | Entry module | How it loads |
| --- | --- | --- |

## Standalone HTML entry points
`
  );

  await fs.mkdir(path.join(root, 'tests'), { recursive: true });

  return root;
}

describe('scaffold-toy CLI helpers', () => {
  test('writes module, metadata, index row, and test file when requested', async () => {
    const root = await createTempRepo();
    const slug = 'ripple-orb';
    const title = 'Ripple Orb';
    const description = 'Gentle rippling spheres.';

    const log = mock(() => {});
    const originalConsoleLog = console.log;
    console.log = (...args) => {
      log(args);
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
    expect(moduleContents).toContain('export async function start');

    const data = await fs.readFile(path.join(root, 'assets/js/toys-data.js'), 'utf8');
    expect(data).toContain(`slug: '${slug}'`);
    expect(data).toContain(`title: '${title}'`);
    expect(data).toContain(description);

    const index = await fs.readFile(path.join(root, 'docs/TOY_SCRIPT_INDEX.md'), 'utf8');
    expect(index).toContain(`| \`${slug}\``);
    expect(index.indexOf(slug)).toBeLessThan(index.indexOf('## Standalone HTML entry points'));

    const testSpec = await fs.readFile(path.join(root, 'tests', `${slug}.test.ts`), 'utf8');
    expect(testSpec).toContain(`describe('${slug} toy scaffold'`);

    console.log = originalConsoleLog;
  });

  test('throws when a duplicate slug exists in metadata', async () => {
    const root = await createTempRepo();
    await fs.writeFile(
      path.join(root, 'assets/js/toys-data.js'),
      "export default [\n  { slug: 'dupe', title: 'Existing', module: 'assets/js/toys/dupe.ts', type: 'module' },\n];\n"
    );

    await expect(
      scaffoldToy({
        slug: 'dupe',
        title: 'Duplicate',
        description: 'Existing slug',
        type: 'module',
        createTest: false,
        root,
      })
    ).rejects.toThrow(/already exists/);
  });
});
