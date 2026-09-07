/**
 * `preview-failures.json` is the record check-catalog-integrity reads as
 * "these presets have no usable preview". It used to be overwritten with
 * whatever the last sweep found, so a run over a subset silently dropped
 * every id it had not visited — a 303-preset re-sweep emptied a 238-entry
 * report, and the record only survived because it was still in git.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writePreviewFailures } from '../../scripts/generate-thumbnails.ts';

/** A previews dir plus a report, seeded with whatever the case needs. */
function scratch(options: {
  previews?: string[];
  report?: Array<{ presetId: string; reason: string }>;
}) {
  const root = mkdtempSync(path.join(tmpdir(), 'stims-preview-report-'));
  const previewsDir = path.join(root, 'previews');
  mkdirSync(previewsDir, { recursive: true });
  for (const id of options.previews ?? []) {
    writeFileSync(path.join(previewsDir, `${id}.png`), 'not-really-a-png');
  }
  const reportPath = path.join(root, 'preview-failures.json');
  if (options.report) {
    writeFileSync(reportPath, `${JSON.stringify(options.report, null, 2)}\n`);
  }
  const read = () =>
    JSON.parse(readFileSync(reportPath, 'utf8')) as Array<{
      presetId: string;
      reason: string;
    }>;
  return { previewsDir, reportPath, read };
}

describe('writePreviewFailures', () => {
  test('keeps entries this run never looked at', () => {
    const { previewsDir, reportPath, read } = scratch({
      report: [
        { presetId: 'untouched-one', reason: 'black frame' },
        { presetId: 'untouched-two', reason: 'flat frame' },
      ],
    });

    writePreviewFailures([], [{ id: 'swept' }], { previewsDir, reportPath });

    expect(read().map((entry) => entry.presetId)).toEqual([
      'untouched-one',
      'untouched-two',
    ]);
  });

  test('drops a carried entry once it has a preview again', () => {
    const { previewsDir, reportPath, read } = scratch({
      previews: ['recovered'],
      report: [
        { presetId: 'recovered', reason: 'black frame' },
        { presetId: 'still-broken', reason: 'black frame' },
      ],
    });

    writePreviewFailures([], [{ id: 'unrelated' }], {
      previewsDir,
      reportPath,
    });

    expect(read().map((entry) => entry.presetId)).toEqual(['still-broken']);
  });

  test('records this run only for presets left with no image', () => {
    const { previewsDir, reportPath, read } = scratch({
      previews: ['kept-its-old-preview'],
    });

    writePreviewFailures(
      [
        { presetId: 'kept-its-old-preview', reason: 'black frame' },
        { presetId: 'never-rendered', reason: 'black frame' },
      ],
      [{ id: 'kept-its-old-preview' }, { id: 'never-rendered' }],
      { previewsDir, reportPath },
    );

    // A recapture that came back black keeps the good image it already had;
    // listing it would strip `preview: true` off a picture that renders fine.
    expect(read().map((entry) => entry.presetId)).toEqual(['never-rendered']);
  });

  test('a preset this run proved fine stops being listed', () => {
    const { previewsDir, reportPath, read } = scratch({
      previews: ['fixed-this-run'],
      report: [{ presetId: 'fixed-this-run', reason: 'black frame' }],
    });

    writePreviewFailures([], [{ id: 'fixed-this-run' }], {
      previewsDir,
      reportPath,
    });

    expect(read()).toEqual([]);
  });

  test('an unreadable report does not lose this run findings', () => {
    const { previewsDir, reportPath, read } = scratch({});
    writeFileSync(reportPath, '{ not json');

    writePreviewFailures([{ presetId: 'broken', reason: 'black frame' }], [], {
      previewsDir,
      reportPath,
    });

    expect(read().map((entry) => entry.presetId)).toEqual(['broken']);
  });
});
