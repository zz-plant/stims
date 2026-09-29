/**
 * The served-vs-repo verdict is the one decision in the preview audit that
 * costs real time to get wrong, because the two outcomes have wildly different
 * prices. `upload` is one request. `recapture` is minutes-to-hours of browser
 * sim per preset. Reporting an unusable served frame as `upload` sends an
 * operator to re-publish a black PNG and change nothing; reporting it as
 * `recapture` when the repo copy is fine sends them to re-render a picture they
 * already have. Both mistakes are silent, so both are pinned here.
 *
 * The regression this file exists for: a bespoke luma threshold in the auditor
 * instead of the generator's own badFrameReason would report every
 * sparse-bright preset — legitimately dark, mean ~5/255 — as broken, and the
 * report would then list hundreds of healthy presets under `recapture`.
 */
import { describe, expect, test } from 'bun:test';
import {
  classifyPreview,
  renderKindSection,
  selectPreviewIds,
} from '../../scripts/audit-production-previews.ts';
import type { FrameStats } from '../../scripts/frame-stats.ts';

/** A frame the generator would accept: lit, structured, unclipped. */
const lit = (hash: string, mean: number, std: number): FrameStats => ({
  hash,
  meanLuma: mean,
  maxLuma: 240,
  stdLuma: std,
  blownFraction: 0,
});

/** A few glowing shapes on black: mean is tiny, which is the point of it. */
const sparse = (hash: string, std = 35): FrameStats => ({
  hash,
  meanLuma: 4.9,
  maxLuma: 255,
  stdLuma: std,
  blownFraction: 0.02,
});

/** No render: nothing bright anywhere. */
const black: FrameStats = {
  hash: 'black',
  meanLuma: 0,
  maxLuma: 0,
  stdLuma: 0,
  blownFraction: 0,
};

/** Lit, but one flat value — a solid colour is not a render. */
const flat: FrameStats = {
  hash: 'flat',
  meanLuma: 128,
  maxLuma: 128,
  stdLuma: 0,
  blownFraction: 0,
};

describe('classifyPreview — unusable served frames', () => {
  test('black served, good repo copy: upload, not a recapture', () => {
    const verdict = classifyPreview(black, lit('repo', 60, 40));

    expect(verdict?.kind).toBe('upload');
    expect(verdict?.detail).toContain('served black frame');
    // The detail is what an operator reads before acting, so it has to say the
    // repo copy is the good one.
    expect(verdict?.detail).toContain('repo ok');
  });

  test('flat served, good repo copy: upload', () => {
    expect(classifyPreview(flat, lit('repo', 60, 40))?.kind).toBe('upload');
  });

  test('black served and black in the repo: recapture', () => {
    // Re-uploading a black capture is the failure mode this verdict prevents.
    expect(classifyPreview(black, black)?.kind).toBe('recapture');
  });

  test('flat served and flat in the repo: recapture', () => {
    expect(classifyPreview(flat, flat)?.kind).toBe('recapture');
  });

  test('served unusable with no repo capture: recapture', () => {
    // Nothing to upload, so the only fix is a capture.
    const verdict = classifyPreview(black, null);

    expect(verdict?.kind).toBe('recapture');
    expect(verdict?.detail).toContain('repo missing');
  });
});

describe('classifyPreview — usable served frames', () => {
  test('identical bytes: no finding', () => {
    const stats = lit('same', 60, 40);

    expect(classifyPreview(stats, { ...stats })).toBeNull();
  });

  test('sparse-bright served and repo copy: judged on score, not brightness', () => {
    // Both sides are legitimately dark. A mean-based check would call both
    // broken and route this to a recapture; the verdict here is purely "is the
    // repo copy the better picture".
    const stale = classifyPreview(sparse('served', 35), sparse('repo', 50));
    const better = classifyPreview(sparse('repo', 50), sparse('served', 35));
    const worse = classifyPreview(sparse('repo', 50), sparse('served', 80));

    expect(stale?.kind).toBe('upload');
    expect(better?.kind).toBe('regression');
    expect(worse?.kind).toBe('upload');
  });

  test('stale served copy is an upload, and the detail carries both scores', () => {
    const verdict = classifyPreview(lit('served', 60, 40), lit('repo', 60, 70));

    expect(verdict?.kind).toBe('upload');
    expect(verdict?.detail).toMatch(/^served [\d.]+ vs repo [\d.]+$/);
  });

  test('a repo copy that scores the same as production is not an upload', () => {
    // Equal scores with different bytes: a recapture that found the same
    // plateau. Publishing it would churn the object store for nothing.
    expect(
      classifyPreview(lit('served', 60, 40), lit('repo', 60, 40))?.kind,
    ).toBe('regression');
  });

  test('repo copy scoring worse is a regression, never an upload', () => {
    // The generator's checkpoint search is a plateau search, so a fresh capture
    // can be worse than the one on disk. Uploading it would trade a stale card
    // for a worse one.
    const verdict = classifyPreview(lit('served', 60, 70), lit('repo', 60, 40));

    expect(verdict?.kind).toBe('regression');
  });

  test('served with no repo capture: missing-local', () => {
    const verdict = classifyPreview(lit('served', 60, 40), null);

    expect(verdict?.kind).toBe('missing-local');
  });

  test('a broken repo copy is never published over a good served frame', () => {
    // Served sparse-bright, repo black. The scores say "repo is worse", and
    // the verdict must not be `upload` in any reading of the rule — publishing
    // a black capture would replace a working share card with a broken one.
    // Production is left alone and the repo copy is what needs the recapture.
    const verdict = classifyPreview(sparse('served'), black);

    expect(verdict?.kind).toBe('regression');
    expect(verdict?.detail).toMatch(/^served 20\.\d vs repo 0\.0$/);
  });
});

describe('selectPreviewIds', () => {
  const presets = Array.from({ length: 10 }, (_, i) => ({
    id: `p${i}`,
    order: i,
  }));

  test('audits everything when no sample is requested', () => {
    expect(selectPreviewIds(presets)).toEqual(presets.map((p) => p.id));
  });

  test('skips presets the catalog marks as having no preview', () => {
    const withMissing = presets.map((p, i) =>
      i % 3 === 0 ? { ...p, preview: false } : p,
    );

    // p0, p3, p6, p9 are marked.
    expect(selectPreviewIds(withMissing)).toEqual([
      'p1',
      'p2',
      'p4',
      'p5',
      'p7',
      'p8',
    ]);
  });

  test('a sample is a deterministic stride, not a random subset', () => {
    const first = selectPreviewIds(presets, 3);

    // Re-running the audit after an upload has to re-check the same ids, or
    // the "before" and "after" reports are not comparable.
    expect(first).toEqual(selectPreviewIds(presets, 3));
    expect(first).toEqual(['p0', 'p3', 'p6']);
  });

  test('a sample at or above the catalog size audits everything', () => {
    expect(selectPreviewIds(presets, 10)).toHaveLength(10);
    expect(selectPreviewIds(presets, 25)).toHaveLength(10);
  });
});

describe('report sections', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `p${i}`, detail: 'd' }));

  test('missing-local collapses to one line by default so actionable kinds stay visible', () => {
    const lines = renderKindSection('missing-local', rows(1746), false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('1746');
    expect(lines[0]).toContain('--verbose');
  });

  test('--verbose lists missing-local rows', () => {
    const lines = renderKindSection('missing-local', rows(3), true);
    expect(lines).toEqual([
      '## missing-local (3)',
      '  p0\td',
      '  p1\td',
      '  p2\td',
    ]);
  });

  test('actionable kinds always list their rows, capped with a remainder count', () => {
    const lines = renderKindSection('recapture', rows(45), false);
    expect(lines[0]).toBe('## recapture (45)');
    expect(lines).toHaveLength(1 + 40 + 1);
    expect(lines.at(-1)).toBe('  … 5 more');
  });

  test('an empty kind prints nothing', () => {
    expect(renderKindSection('upload', [], false)).toEqual([]);
  });
});
