import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildVisualReportItem,
  runDecisionLab,
} from '../../scripts/preset-lab-decisions.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('decision lab', () => {
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
