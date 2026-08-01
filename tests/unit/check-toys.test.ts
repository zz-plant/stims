import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runToyChecks } from '../../scripts/check-toys.ts';
import {
  buildManifestModule,
  buildManifestSource,
  buildPublicToysJson,
  buildToyNotes,
  buildToyScriptIndex,
} from '../../scripts/generate-toy-manifest.ts';

async function createTempRepo() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'toy-checks-'));
  await fs.mkdir(path.join(root, 'src/js/toys'), { recursive: true });
  await fs.mkdir(path.join(root, 'src/js/data'), { recursive: true });
  await fs.mkdir(path.join(root, 'src/data'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.mkdir(path.join(root, 'public'), { recursive: true });
  await fs.mkdir(path.join(root, 'public/milkdrop-presets'), {
    recursive: true,
  });

  const index = `# Toy Script Index\n\nplaceholder\n`;
  await fs.writeFile(path.join(root, 'docs/TOY_SCRIPT_INDEX.md'), index);
  await fs.writeFile(
    path.join(root, 'docs/toys.md'),
    '# Toy Manifest Reference\n',
  );

  await fs.writeFile(path.join(root, 'src/data/toys.json'), '[]\n');
  await fs.writeFile(
    path.join(root, 'src/js/data/toy-manifest.ts'),
    'export const toyManifest = [];\n',
  );
  await fs.writeFile(path.join(root, 'public/toys.json'), '[]\n');
  await fs.writeFile(
    path.join(root, 'public/milkdrop-presets/catalog.json'),
    '{"presets":[]}\n',
  );
  await fs.writeFile(path.join(root, 'README.md'), '# temp repo\n');
  return root;
}

async function writeToyModule(root: string, slug: string) {
  const modulePath = path.join(root, 'src/js/toys', `${slug}.ts`);
  await fs.writeFile(modulePath, `export const start = () => {};\n`);
}

async function writeGeneratedArtifacts(root: string, entries: unknown) {
  const manifest = buildManifestSource(entries, 'src/data/toys.json');
  await fs.writeFile(
    path.join(root, 'src/js/data/toy-manifest.ts'),
    buildManifestModule(manifest),
  );
  await fs.writeFile(
    path.join(root, 'public/toys.json'),
    buildPublicToysJson(manifest),
  );
  await fs.writeFile(
    path.join(root, 'docs/TOY_SCRIPT_INDEX.md'),
    buildToyScriptIndex(manifest),
  );
  await fs.writeFile(path.join(root, 'docs/toys.md'), buildToyNotes(manifest));
}

describe('check-toys script', () => {
  test('passes when metadata and files are consistent', async () => {
    const root = await createTempRepo();
    const entries = [
      {
        slug: 'aligned',
        title: 'Aligned',
        description: 'ok',
        module: 'src/js/toys/aligned.ts',
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
        module: 'src/js/toys/steady-bloom.ts',
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
      path.join(root, 'src/data/toys.json'),
      `${JSON.stringify(entries, null, 2)}\n`,
    );
    await writeGeneratedArtifacts(root, entries);
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
        module: `src/js/toys/${slug}.ts`,
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
      path.join(root, 'src/data/toys.json'),
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
        module: `src/js/toys/${slug}.ts`,
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
      path.join(root, 'src/data/toys.json'),
      `${JSON.stringify(entries, null, 2)}\n`,
    );
    await fs.writeFile(
      path.join(root, 'src/js/data/toy-manifest.ts'),
      'export const toyManifest = [] as const;\n',
    );
    await fs.writeFile(path.join(root, 'public/toys.json'), '[]\n');
    await fs.writeFile(
      path.join(root, 'docs/TOY_SCRIPT_INDEX.md'),
      '# Toy Script Index\n\nout of date\n',
    );
    await fs.writeFile(path.join(root, 'docs/toys.md'), '# stale\n');

    const result = await runToyChecks(root);
    expect(
      result.issues.some((issue) =>
        issue.includes(
          'Generated artifact out of date: src/js/data/toy-manifest.ts',
        ),
      ),
    ).toBe(true);
    expect(
      result.issues.some((issue) =>
        issue.includes('Run: bun run generate:toys'),
      ),
    ).toBe(true);
    expect(
      result.issues.some((issue) =>
        issue.includes(
          'Generated artifact out of date: docs/TOY_SCRIPT_INDEX.md',
        ),
      ),
    ).toBe(true);
    expect(
      result.issues.some((issue) =>
        issue.includes('Generated artifact out of date: docs/toys.md'),
      ),
    ).toBe(true);
  });

  test('fails when generated docs are missing', async () => {
    const root = await createTempRepo();
    const slug = 'missing-docs';
    await writeToyModule(root, slug);

    const entries = [
      {
        slug,
        title: 'Missing Docs',
        description: 'ok',
        module: `src/js/toys/${slug}.ts`,
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
      path.join(root, 'src/data/toys.json'),
      `${JSON.stringify(entries, null, 2)}\n`,
    );
    await fs.writeFile(
      path.join(root, 'src/js/data/toy-manifest.ts'),
      buildManifestModule(buildManifestSource(entries, 'src/data/toys.json')),
    );
    await fs.writeFile(
      path.join(root, 'public/toys.json'),
      buildPublicToysJson(buildManifestSource(entries, 'src/data/toys.json')),
    );
    await fs.rm(path.join(root, 'docs/TOY_SCRIPT_INDEX.md'));
    await fs.rm(path.join(root, 'docs/toys.md'));

    const result = await runToyChecks(root);
    expect(
      result.issues.some((issue) =>
        issue.includes('Generated artifact missing: docs/TOY_SCRIPT_INDEX.md'),
      ),
    ).toBe(true);
    expect(
      result.issues.some((issue) =>
        issue.includes('Generated artifact missing: docs/toys.md'),
      ),
    ).toBe(true);
  });

  test('flags registered toy modules that do not export start', async () => {
    const root = await createTempRepo();
    const slug = 'missing-start';

    await fs.writeFile(
      path.join(root, 'src/js/toys', `${slug}.ts`),
      'export const notStart = () => {};\n',
    );

    const entries = [
      {
        slug,
        title: 'Missing Start',
        description: 'oops',
        module: `src/js/toys/${slug}.ts`,
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
      path.join(root, 'src/data/toys.json'),
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

  test('fails when the README preset count drifts from the public catalog', async () => {
    const root = await createTempRepo();
    await fs.writeFile(
      path.join(root, 'public/milkdrop-presets/catalog.json'),
      JSON.stringify({ presets: [{ id: 'one' }, { id: 'two' }] }),
    );
    await fs.writeFile(
      path.join(root, 'README.md'),
      '# temp repo\n\nExplore the **3-preset catalog**.\n',
    );

    const result = await runToyChecks(root);

    expect(
      result.issues.some((issue) =>
        issue.includes(
          'README preset count is 3, but public/milkdrop-presets/catalog.json contains 2 entries',
        ),
      ),
    ).toBe(true);
  });

  test('checks every README preset-count claim format used by the product copy', async () => {
    const root = await createTempRepo();
    await fs.writeFile(
      path.join(root, 'public/milkdrop-presets/catalog.json'),
      JSON.stringify({ presets: [{ id: 'one' }, { id: 'two' }] }),
    );
    await fs.writeFile(
      path.join(root, 'README.md'),
      [
        '# temp repo',
        '',
        '| **3 Presets** | Browse the catalog. |',
        '',
        'Search over 3+ preset embeddings.',
      ].join('\n'),
    );

    const result = await runToyChecks(root);
    const countIssues = result.issues.filter((issue) =>
      issue.includes(
        'README preset count is 3, but public/milkdrop-presets/catalog.json contains 2 entries',
      ),
    );

    expect(countIssues).toHaveLength(2);
  });

  for (const claim of [
    {
      name: 'stem separation',
      copy: '**Stem-Aware Audio Engine** isolates vocals and drums into live visual uniforms.',
      expected:
        'README presents stem separation as shipped, but the runtime currently exposes reserved stem signals only',
    },
    {
      name: 'integrated MIDI control',
      copy: '**WebMIDI & VJ Controls** map physical controls directly to live visual parameters.',
      expected:
        'README presents MIDI control as fully shipped, but the current integration still lacks device-backed verification and persistent mappings',
    },
    {
      name: 'an immersive XR stage',
      copy: '**WebXR 6DoF Spatial VR Stage** provides an immersive spatial visualizer.',
      expected:
        'README presents an immersive XR stage as fully shipped, but the current integration still lacks device-backed visual and audio verification',
    },
    {
      name: 'native 4K audio-video export',
      copy: '**4K / 60FPS Video Export** produces creator-ready audio and video.',
      expected:
        'README presents creator-ready 4K audio-video export as fully shipped, but the native render and audio path still requires browser-backed output verification',
    },
    {
      name: 'model generation bundled with blending',
      copy: '**AI Generation & Blending** creates every requested visual from a language model.',
      expected:
        'README presents model generation and blending as one fully shipped feature, but generation requires a configured hosted or local model and blending remains an optional API',
    },
  ]) {
    test(`fails when the README promotes ${claim.name} as shipped`, async () => {
      const root = await createTempRepo();
      await fs.writeFile(
        path.join(root, 'README.md'),
        `# temp repo\n\n${claim.copy}\n`,
      );

      const result = await runToyChecks(root);

      expect(
        result.issues.some((issue) => issue.includes(claim.expected)),
      ).toBe(true);
    });
  }
});
