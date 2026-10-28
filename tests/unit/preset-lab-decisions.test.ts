import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildVisualReportItem,
  runDecisionLab,
} from '../../scripts/preset-lab-decisions.ts';
import {
  type DecisionAnswers,
  type DecisionResult,
  decisionQuestions,
} from '../../src/js/core/decision-model.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function applyFixture(reportId = 'b') {
  const root = mkdtempSync(join(tmpdir(), 'stims-decision-apply-'));
  dirs.push(root);
  const catalogDir = join(root, 'public/milkdrop-presets');
  mkdirSync(catalogDir, { recursive: true });
  const hash = (source: string) =>
    createHash('sha256').update(source).digest('hex');
  for (const id of ['a', 'b', 'current'])
    writeFileSync(join(catalogDir, `${id}.milk`), `current ${id}`);
  writeFileSync(
    join(catalogDir, 'catalog.json'),
    JSON.stringify({
      presets: [
        {
          id: 'a',
          file: '/milkdrop-presets/a.milk',
          tags: ['category:one', 'look:tunnel', 'look:manual'],
        },
        { id: 'b', file: '/milkdrop-presets/b.milk', tags: ['category:two'] },
        {
          id: 'current',
          file: '/milkdrop-presets/current.milk',
          tags: ['curated', 'look:cool'],
        },
        {
          id: 'missing',
          file: '/milkdrop-presets/missing.milk',
          tags: ['other', 'look:organic'],
        },
      ],
    }),
  );
  writeFileSync(
    join(catalogDir, 'decision-profiles.json'),
    JSON.stringify({
      version: 1,
      profiles: [
        {
          id: 'a',
          sourceHash: hash('old a'),
          tags: ['look:tunnel'],
          contexts: [],
        },
        {
          id: 'current',
          sourceHash: hash('current current'),
          tags: ['look:cool'],
          contexts: [],
        },
        {
          id: 'missing',
          sourceHash: hash('missing'),
          tags: ['look:organic'],
          contexts: [],
        },
        {
          id: 'deleted',
          sourceHash: hash('deleted'),
          tags: ['look:particles'],
          contexts: [],
        },
      ],
    }),
  );
  const answers: DecisionAnswers = {};
  for (const [key, question] of Object.entries(
    decisionQuestions({ task: 'visual-profile', state: {} }),
  )) {
    if (question.type === 'noul')
      answers[key] = {
        type: 'noul',
        noul:
          key === 'sufficient_evidence' || key === 'motif_tunnel' ? 0.99 : 0.01,
      };
    else if (question.type === 'choice')
      answers[key] = {
        type: 'choice',
        choice: 'cool',
        confidence: 0.96,
        probabilities: Object.fromEntries(
          Object.keys(question.criteria).map((option) => [
            option,
            option === 'cool' ? 0.96 : 0.01,
          ]),
        ),
      };
    else
      answers[key] = {
        type: 'score',
        score: 1,
        confidence: 0.98,
        probabilities: { '0': 0.01, '1': 0.98, '2': 0.01 },
        legend: Object.fromEntries(
          question.criteria.map((level, index) => [String(index), level]),
        ),
      };
  }
  const result: DecisionResult = {
    version: 1,
    task: 'visual-profile',
    model: 'clef-flash',
    answers,
    disposition: 'accepted',
    provenance: {
      questionVersion: 'stims-clef-v1',
      evaluatedAt: '2026-10-18T00:00:00.000Z',
      inputHash: 'a'.repeat(64),
    },
  };
  const records = (['webgl', 'webgpu'] as const).flatMap((renderer) =>
    [
      [1280, 720],
      [390, 844],
    ].map(([width, height]) => ({
      id: `${reportId}-${renderer}-${width}`,
      presetId: reportId,
      sourceHash: hash(reportId === 'a' ? 'old a' : `current ${reportId}`),
      context: { renderer, width, height, audioScenario: 'demo' },
      request: { task: 'visual-profile', state: {}, model: 'clef-flash' },
      result,
      latencyMs: 1,
    })),
  );
  const reportFile = join(root, 'report.json');
  writeFileSync(reportFile, JSON.stringify({ version: 1, records }));
  const execution = Bun.spawnSync({
    cmd: [
      process.execPath,
      fileURLToPath(
        new URL('../../scripts/preset-lab-decisions.ts', import.meta.url),
      ),
      '--apply',
      reportFile,
    ],
    cwd: root,
  });
  return {
    execution,
    catalog: JSON.parse(readFileSync(join(catalogDir, 'catalog.json'), 'utf8')),
    manifest: JSON.parse(
      readFileSync(join(catalogDir, 'decision-profiles.json'), 'utf8'),
    ),
  };
}

describe('decision lab', () => {
  test('applying another preset revalidates all saved profiles and removes only stale owned look tags', () => {
    const { execution, catalog, manifest } = applyFixture();
    expect(execution.exitCode).toBe(0);
    expect(
      manifest.profiles.map((profile: { id: string }) => profile.id).sort(),
    ).toEqual(['b', 'current']);
    expect(
      catalog.presets.find((entry: { id: string }) => entry.id === 'a').tags,
    ).toEqual(['category:one', 'look:manual']);
    expect(
      catalog.presets.find((entry: { id: string }) => entry.id === 'missing')
        .tags,
    ).toEqual(['other']);
    expect(
      catalog.presets.find((entry: { id: string }) => entry.id === 'current')
        .tags,
    ).toEqual(['curated', 'look:cool']);
    expect(
      catalog.presets.find((entry: { id: string }) => entry.id === 'b').tags,
    ).toEqual(['category:two', 'look:tunnel', 'look:cool']);
  });
  test('an apply still saves invalidation when its new records no longer match source', () => {
    const { execution, catalog, manifest } = applyFixture('a');
    expect(execution.exitCode).toBe(0);
    expect(
      manifest.profiles.map((profile: { id: string }) => profile.id),
    ).toEqual(['current']);
    expect(
      catalog.presets.find((entry: { id: string }) => entry.id === 'a').tags,
    ).toEqual(['category:one', 'look:manual']);
  });
  test('loads local evidence for the request but saves only hashes, not media bytes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stims-decisions-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'frame.png'), Buffer.from(png, 'base64'));
    let transmitted = '';
    const records = await runDecisionLab(
      [
        {
          id: 'sample',
          request: { task: 'capture-review', state: {} },
          imageFiles: [join(dir, 'frame.png')],
        },
      ],
      {
        endpoint: 'https://example.com/api/decide',
        fetcher: async (_url, init) => {
          transmitted = String(init?.body);
          return new Response('', { status: 503 });
        },
      },
    );
    expect(transmitted).toContain(png);
    expect(JSON.stringify(records)).not.toContain(png);
    expect(records[0].mediaHashes?.[0]).toHaveLength(64);
    expect(records[0].error).toContain('503');
    expect(records[0].request).toEqual({
      task: 'capture-review',
      state: {},
      model: 'clef-flash',
    });
  });

  test('rejects duplicate item ids before calling the service', async () => {
    let calls = 0;
    const item = {
      id: 'same',
      request: { task: 'capture-review' as const, state: {} },
    };
    await expect(
      runDecisionLab([item, item], {
        endpoint: 'https://example.com',
        fetcher: async () => {
          calls += 1;
          return new Response();
        },
      }),
    ).rejects.toThrow('Duplicate');
    expect(calls).toBe(0);
  });

  test('carries actual renderer and viewport evidence from a visual report', () => {
    const item = buildVisualReportItem(
      {
        presetId: 'p',
        renderer: 'webgl',
        sourceHash: 'a'.repeat(64),
        scenarios: Object.fromEntries(
          ['silence', 'demo', 'steady'].map((name) => [
            name,
            { backend: 'webgl', loadError: null },
          ]),
        ),
        viewport: { width: 390, height: 844 },
        artifacts: { contactSheet: '/capture/contact.png' },
      },
      'a blue tunnel',
    );
    expect(item.context).toEqual({
      renderer: 'webgl',
      width: 390,
      height: 844,
      audioScenario: 'silence+demo+steady',
    });
    expect(item.request).toEqual({
      task: 'prompt-match',
      state: { prompt: 'a blue tunnel' },
    });
    expect(item.sourceHash).toHaveLength(64);
    expect(item.imageFiles).toEqual(['/capture/contact.png']);
  });

  test('requested WebGPU with actual WebGL fallback cannot claim WebGPU evidence', () => {
    const item = buildVisualReportItem({
      presetId: 'p',
      renderer: 'webgpu',
      viewport: { width: 1280, height: 720 },
      sourceHash: 'a'.repeat(64),
      scenarios: Object.fromEntries(
        ['silence', 'demo', 'steady'].map((name) => [
          name,
          { backend: 'webgl', loadError: null },
        ]),
      ),
      artifacts: { contactSheet: '/fallback.png' },
    });
    expect(item.context).toBeUndefined();
    expect(item.sourceHash).toBeUndefined();
  });

  test('a legacy capture cannot acquire provenance from current source', () => {
    const item = buildVisualReportItem({
      presetId: 'p',
      renderer: 'webgl',
      viewport: { width: 1280, height: 720 },
      artifacts: { contactSheet: '/old.png' },
    });
    expect(item.sourceHash).toBeUndefined();
  });

  test('old reports without a viewport cannot claim contextual promotion evidence', () => {
    const item = buildVisualReportItem({
      presetId: 'p',
      renderer: 'webgpu',
      artifacts: { contactSheet: '/capture/contact.png' },
    });
    expect(item.context).toBeUndefined();
    expect(item.sourceHash).toBeUndefined();
    expect(item.request.task).toBe('visual-profile');
  });
});
