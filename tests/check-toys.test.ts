import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runToyChecks } from '../scripts/check-toys.ts';
import {
  buildManifestModule,
  buildManifestSource,
  buildPublicToysJson,
} from '../scripts/generate-toy-manifest.ts';

async function createTempRepo() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'toy-checks-'));
  await fs.mkdir(path.join(root, 'assets/js/toys'), { recursive: true });
  await fs.mkdir(path.join(root, 'assets/js/data'), { recursive: true });
  await fs.mkdir(path.join(root, 'assets/data'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.mkdir(path.join(root, 'public'), { recursive: true });

  const index = `# Toy and Visualizer Script Index\n\n## Query-driven toys (\`toy.html\`)\n| Slug | Entry module | How it loads |\n| --- | --- | --- |\n\n## Generated public toy pages\n`;
  await fs.writeFile(path.join(root, 'docs/TOY_SCRIPT_INDEX.md'), index);

  await fs.writeFile(path.join(root, 'assets/data/toys.json'), '[]\n');
  await fs.writeFile(
    path.join(root, 'assets/js/data/toy-manifest.ts'),
    'export const toyManifest = [];\n',
  );
  await fs.writeFile(path.join(root, 'public/toys.json'), '[]\n');
  await fs.writeFile(path.join(root, 'README.md'), '# temp repo\n');
  return root;
}

async function writeToyModule(root: string, slug: string) {
  const modulePath = path.join(root, 'assets/js/toys', `${slug}.ts`);
  await fs.writeFile(modulePath, `export const start = () => {};\n`);
}

async function writeGeneratedArtifacts(root: string, entries: unknown) {
  const manifest = buildManifestSource(entries, 'assets/data/toys.json');
  await fs.writeFile(
    path.join(root, 'assets/js/data/toy-manifest.ts'),
    buildManifestModule(manifest),
  );
  await fs.writeFile(
    path.join(root, 'public/toys.json'),
    buildPublicToysJson(manifest),
  );
}

describe('check-toys script', () => {
  test('passes when metadata and files are consistent', async () => {
    const root = await createTempRepo();
    const entries = [
      {
        slug: 'aligned',
        title: 'Aligned',
        description: 'ok',
        module: 'assets/js/toys/aligned.ts',
        type: 'module',
        requiresWebGPU: false,
        capabilities: {
          microphone: true,
          demoAudio: true,
          motion: false,
        },
      },
      {
        slug: 'steady-bloom',
        title: 'Steady Bloom',
        description: 'ok',
        module: 'assets/js/toys/steady-bloom.ts',
        type: 'module',
        requiresWebGPU: false,
        capabilities: {
          microphone: true,
          demoAudio: true,
          motion: false,
        },
      },
    ];

    await Promise.all(entries.map((entry) => writeToyModule(root, entry.slug)));

    await fs.writeFile(
      path.join(root, 'assets/data/toys.json'),
      `${JSON.stringify(entries, null, 2)}\n`,
    );
    await writeGeneratedArtifacts(root, entries);
    await fs.appendFile(
      path.join(root, 'docs/TOY_SCRIPT_INDEX.md'),
      entries
        .map(
          (entry) =>
            `| \`${entry.slug}\` | \`${entry.module}\` | Direct module |\n`,
        )
        .join(''),
    );

    const result = await runToyChecks(root);
    expect(result.issues).toHaveLength(0);
  });

  test('flags missing entry files', async () => {
    const root = await createTempRepo();
    const slug = 'missing-entry';

    const entries = [
      {
        slug,
        title: 'Missing Entry',
        description: 'oops',
        module: `assets/js/toys/${slug}.ts`,
        type: 'module',
        requiresWebGPU: false,
        capabilities: {
          microphone: true,
          demoAudio: true,
          motion: false,
        },
      },
    ];

    await fs.writeFile(
      path.join(root, 'assets/data/toys.json'),
      `${JSON.stringify(entries, null, 2)}\n`,
    );
    await writeGeneratedArtifacts(root, entries);

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
    await writeGeneratedArtifacts(root, []);

    const result = await runToyChecks(root);
    expect(
      result.issues.some((issue) =>
        issue.includes('Unregistered toy module detected'),
      ),
    ).toBe(true);
  });

  test('fails when generated artifacts drift from toy metadata source', async () => {
    const root = await createTempRepo();
    const slug = 'drift-check';
    await writeToyModule(root, slug);

    const entries = [
      {
        slug,
        title: 'Drift Check',
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
    ];

    await fs.writeFile(
      path.join(root, 'assets/data/toys.json'),
      `${JSON.stringify(entries, null, 2)}\n`,
    );
    await fs.writeFile(
      path.join(root, 'assets/js/data/toy-manifest.ts'),
      'export const toyManifest = [] as const;\n',
    );
    await fs.writeFile(path.join(root, 'public/toys.json'), '[]\n');

    const result = await runToyChecks(root);
    expect(
      result.issues.some((issue) =>
        issue.includes(
          'Generated artifact out of date: assets/js/data/toy-manifest.ts',
        ),
      ),
    ).toBe(true);
    expect(
      result.issues.some((issue) =>
        issue.includes('Run: bun run generate:toys'),
      ),
    ).toBe(true);
  });

  test('flags stale interaction metadata derived from milkdrop behaviors', async () => {
    const root = await createTempRepo();
    await writeToyModule(root, 'aurora-painter');

    const entries = [
      {
        slug: 'aurora-painter',
        title: 'Aurora Painter',
        description: 'ok',
        module: 'assets/js/toys/aurora-painter.ts',
        type: 'module',
        requiresWebGPU: true,
        allowWebGLFallback: true,
        tags: ['wrong'],
        controls: ['Wrong controls'],
        firstRunHint: 'Wrong hint',
        wowControl: 'Wrong wow',
        recommendedCapability: 'microphone',
        capabilities: {
          microphone: true,
          demoAudio: true,
          motion: false,
        },
      },
    ];

    await fs.writeFile(
      path.join(root, 'assets/data/toys.json'),
      `${JSON.stringify(entries, null, 2)}\n`,
    );
    await writeGeneratedArtifacts(root, entries);
    await fs.appendFile(
      path.join(root, 'docs/TOY_SCRIPT_INDEX.md'),
      '| `aurora-painter` | `assets/js/toys/aurora-painter.ts` | Direct module |\n',
    );

    const result = await runToyChecks(root);
    expect(
      result.issues.some((issue) =>
        issue.includes('Behavior-derived interaction metadata is out of date'),
      ),
    ).toBe(true);
  });

  test('flags registered toy modules that do not export start', async () => {
    const root = await createTempRepo();
    const slug = 'missing-start';

    await fs.writeFile(
      path.join(root, 'assets/js/toys', `${slug}.ts`),
      'export const notStart = () => {};\n',
    );

    const entries = [
      {
        slug,
        title: 'Missing Start',
        description: 'oops',
        module: `assets/js/toys/${slug}.ts`,
        type: 'module',
        requiresWebGPU: false,
        capabilities: {
          microphone: true,
          demoAudio: true,
          motion: false,
        },
      },
    ];

    await fs.writeFile(
      path.join(root, 'assets/data/toys.json'),
      `${JSON.stringify(entries, null, 2)}\n`,
    );
    await writeGeneratedArtifacts(root, entries);

    const result = await runToyChecks(root);
    expect(
      result.issues.some((issue) =>
        issue.includes(
          'Registered toy entrypoint is missing an exported start() function',
        ),
      ),
    ).toBe(true);
  });
});
