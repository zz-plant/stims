import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runToyChecks } from '../scripts/check-toys.ts';

async function createTempRepo() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'toy-checks-'));
  await fs.mkdir(path.join(root, 'assets/js/toys'), { recursive: true });
  await fs.mkdir(path.join(root, 'assets/data'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.mkdir(path.join(root, 'toys'), { recursive: true });

  const index = `# Toy and Visualizer Script Index\n\n| Slug | Entry module | How it loads |\n| --- | --- | --- |\n`;
  await fs.writeFile(path.join(root, 'docs/TOY_SCRIPT_INDEX.md'), index);

  await fs.writeFile(path.join(root, 'assets/data/toys.json'), '[]\n');
  return root;
}

async function writeToyModule(root: string, slug: string) {
  const modulePath = path.join(root, 'assets/js/toys', `${slug}.ts`);
  await fs.writeFile(modulePath, `export const start = () => {};\n`);
}

describe('check-toys script', () => {
  test('passes when metadata and files are consistent', async () => {
    const root = await createTempRepo();
    const slug = 'aligned';
    const pageSlug = 'standalone';

    await writeToyModule(root, slug);
    await fs.writeFile(
      path.join(root, 'toys', `${pageSlug}.html`),
      '<!doctype html>',
    );
    await fs.writeFile(
      path.join(root, 'assets/data/toys.json'),
      JSON.stringify(
        [
          {
            slug,
            title: 'Aligned',
            description: 'ok',
            module: `assets/js/toys/${slug}.ts`,
            type: 'module',
            requiresWebGPU: false,
            capabilities: {
              microphone: true,
              demoAudio: true,
              motion: false,
            },
          },
          {
            slug: pageSlug,
            title: 'Standalone',
            description: 'ok',
            module: `toys/${pageSlug}.html`,
            type: 'page',
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
    await fs.appendFile(
      path.join(root, 'docs/TOY_SCRIPT_INDEX.md'),
      `| \`${slug}\` | \`assets/js/toys/${slug}.ts\` | Direct module |\n| \`${pageSlug}\` | \`toys/${pageSlug}.html\` | Standalone HTML page |\n`,
    );

    const result = await runToyChecks(root);
    expect(result.issues).toHaveLength(0);
  });

  test('flags missing entry files', async () => {
    const root = await createTempRepo();
    const slug = 'missing-entry';

    await fs.writeFile(
      path.join(root, 'assets/data/toys.json'),
      JSON.stringify(
        [
          {
            slug,
            title: 'Missing Entry',
            description: 'oops',
            module: `toys/${slug}.html`,
            type: 'page',
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

    const result = await runToyChecks(root);
    expect(
      result.issues.some((issue) =>
        issue.includes('Missing file for missing-entry'),
      ),
    ).toBe(true);
  });

  test('detects unregistered toy modules', async () => {
    const root = await createTempRepo();
    await writeToyModule(root, 'rogue');

    const result = await runToyChecks(root);
    expect(result.issues).toContain(
      'Unregistered toy module detected: assets/js/toys/rogue.ts',
    );
  });
});
