import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  FIRST_RUN_EVIDENCE_PATH,
  FIRST_RUN_VIEWPORTS,
  resolveFirstRunPresetPath,
} from '../../scripts/generate-first-run-evidence.ts';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import { DEFAULT_MILKDROP_PRESET_SOURCE } from '../../src/js/milkdrop/runtime/default-preset.ts';
import {
  FIRST_RUN_PRESET_AUTHOR,
  FIRST_RUN_PRESET_ID,
  FIRST_RUN_PRESET_TITLE,
} from '../../src/js/milkdrop/runtime/first-run-preset.ts';

const repoRoot = path.resolve(import.meta.dir, '../..');
// Resolved through the catalog rather than assumed to sit at the top level:
// the default can legitimately be a preset from one of the bundled libraries,
// which live in subdirectories.
const presetPath = resolveFirstRunPresetPath();
const catalogPath = path.join(repoRoot, 'public/milkdrop-presets/catalog.json');

function findCatalogEntry() {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as {
    presets: {
      id: string;
      title?: string;
      author?: string;
      supports?: Record<string, boolean>;
    }[];
  };
  return catalog.presets.find((preset) => preset.id === FIRST_RUN_PRESET_ID);
}

describe('bundled first-run preset', () => {
  test('is a byte-identical copy of the first-run preset on disk', () => {
    // The bundled copy exists so the pre-catalog frames are already the preset
    // startup selection will land on. If the two drift, the visitor sees one
    // preset and then a crossfade to a different one — the exact failure the
    // copy was added to remove. Regenerate with (splitting on the export, not
    // on the first backtick — the docblock above it contains backticks too):
    //   bun -e "const raw = await Bun.file(<the catalog's file for the preset>).text(); \
    //     const f = 'src/js/milkdrop/runtime/default-preset.ts'; const cur = await Bun.file(f).text(); \
    //     const m = 'export const DEFAULT_MILKDROP_PRESET_SOURCE = \`'; \
    //     await Bun.write(f, cur.slice(0, cur.indexOf(m) + m.length) + raw + '\`;\n')"
    expect(DEFAULT_MILKDROP_PRESET_SOURCE).toBe(
      fs.readFileSync(presetPath, 'utf8'),
    );
  });

  test('is a real catalog id, so startup selection needs no special case', () => {
    const entry = findCatalogEntry();

    expect(entry).toBeDefined();
    // Selectable on both backends: an unsupported backend would send startup
    // selection to a different preset and reintroduce the swap.
    expect(entry?.supports?.webgl).toBe(true);
    expect(entry?.supports?.webgpu).toBe(true);
  });

  test('carries the same title and author the catalog will report', () => {
    // The runtime compiles the bundled source before any catalog exists, so it
    // needs this metadata inline — a third copy alongside catalog.json and
    // starter-catalog.json. Left unchecked, a retitled catalog entry would
    // change the document title and credit mid-load.
    const entry = findCatalogEntry();

    expect(FIRST_RUN_PRESET_TITLE).toBe(entry?.title ?? '');
    expect(FIRST_RUN_PRESET_AUTHOR).toBe(entry?.author ?? '');
  });

  test('compiles without errors', () => {
    const compiled = compileMilkdropPresetSource(
      DEFAULT_MILKDROP_PRESET_SOURCE,
      {
        id: FIRST_RUN_PRESET_ID,
        title: 'first-run',
        origin: 'bundled',
        author: 'test',
      },
    );

    expect(compiled.source.id).toBe(FIRST_RUN_PRESET_ID);
    expect(compiled.ir).toBeDefined();
  });
});

/**
 * The measured bar the first-run preset has to clear.
 *
 * The default has been wrong repeatedly for one reason: what was measured did
 * not predict what a visitor sees. Curated sort order picked a near-black
 * preset, a count of audio-reading variables picked one whose picture did not
 * move with the music, and a landscape-only measurement picked one that is
 * black on every phone held upright. These thresholds state the requirement
 * numerically and are checked against evidence recorded by
 * `bun run generate:first-run-evidence`, so the next change to
 * FIRST_RUN_PRESET_ID has to come with a measurement.
 *
 * Audio response is gated on variables, not pixels. The evidence records
 * `lab:visual`'s pixel signals but nothing enforces them: the demo/silence
 * motion ratio saturates at 1.0 for any preset that moves the whole frame,
 * and ΔL (demo minus silence luminance, from two separate runs) mostly
 * measures where a colour-cycling preset is in its cycle. Two identical runs
 * of shifter-curlique, whose zoom follows the music at correlation 0.84, read
 * ΔL −21 and −0.7.
 */
const EVIDENCE_BAR = {
  /** Below this the frame is too dark to be the product's first impression. */
  minMeanLuminance: 25,
  /** Below this the frame is a few lit pixels on black, not an image. */
  minVisiblePixelRatio: 0.3,
} as const;

type MeasuredBackend = {
  meanLuminance: number;
  visiblePixelRatio: number;
  nearBlackFrameRatio: number;
  steadyMeanLuminance: number;
  steadyVisiblePixelRatio: number;
};

describe('first-run preset evidence', () => {
  const evidence = JSON.parse(
    fs.readFileSync(FIRST_RUN_EVIDENCE_PATH, 'utf8'),
  ) as {
    presetId: string;
    presetSha256: string;
    viewports: Record<
      string,
      {
        width: number;
        height: number;
        backends: Record<string, MeasuredBackend>;
      }
    >;
    reactivity?: {
      motionBearing: Array<{ variable: string; correlation: number }>;
    };
  };

  const measurements = () =>
    Object.entries(evidence.viewports).flatMap(([viewport, entry]) =>
      Object.entries(entry.backends).map(([backend, measured]) => ({
        label: `${viewport} ${backend}`,
        measured,
      })),
    );

  test('describes the preset that actually ships', () => {
    // Swapping the id without re-measuring leaves the landing page making a
    // claim backed by another preset's numbers.
    expect(evidence.presetId).toBe(FIRST_RUN_PRESET_ID);
  });

  test('describes the preset bytes that actually ship', () => {
    // Editing the .milk invalidates the measurement even when the id is
    // unchanged.
    const sha = createHash('sha256')
      .update(fs.readFileSync(presetPath))
      .digest('hex');

    expect(evidence.presetSha256).toBe(sha);
  });

  test('is measured on both backends, on a landscape screen and a phone', () => {
    // The previous default was measured on landscape only and rendered black
    // on every phone held upright, where most first visits happen.
    expect(Object.keys(evidence.viewports).sort()).toEqual(
      Object.keys(FIRST_RUN_VIEWPORTS).sort(),
    );
    for (const [name, size] of Object.entries(FIRST_RUN_VIEWPORTS)) {
      const entry = evidence.viewports[name];
      expect({ width: entry?.width, height: entry?.height }, name).toEqual(
        size,
      );
      expect(Object.keys(entry?.backends ?? {}).sort(), name).toEqual([
        'webgl',
        'webgpu',
      ]);
    }
  });

  test('is bright enough to look at in silence, as the attract preview', () => {
    for (const { label, measured } of measurements()) {
      expect(
        measured.meanLuminance,
        `${label} mean luminance`,
      ).toBeGreaterThanOrEqual(EVIDENCE_BAR.minMeanLuminance);
      expect(
        measured.visiblePixelRatio,
        `${label} visible pixels`,
      ).toBeGreaterThanOrEqual(EVIDENCE_BAR.minVisiblePixelRatio);
      expect(measured.nearBlackFrameRatio, `${label} near-black`).toBe(0);
    }
  });

  test('stays bright once demo audio has played for ~30s', () => {
    // What a visitor watches after pressing Play demo. The previous default
    // passed every silence check on a phone and settled at luminance 6 here.
    for (const { label, measured } of measurements()) {
      expect(
        measured.steadyMeanLuminance,
        `${label} settled mean luminance`,
      ).toBeGreaterThanOrEqual(EVIDENCE_BAR.minMeanLuminance);
      expect(
        measured.steadyVisiblePixelRatio,
        `${label} settled visible pixels`,
      ).toBeGreaterThanOrEqual(EVIDENCE_BAR.minVisiblePixelRatio);
    }
  });

  test('answers to audio through a variable the whole frame moves with', () => {
    // The landing page promises visuals that move to the music. q-vars and
    // wave deviation do not count: the 08-22 default had eight "reactive"
    // variables and none of them moved the picture. zoom, rot, warp, sx, sy,
    // cx, cy, dx, dy, decay and shape motion do.
    expect(evidence.reactivity?.motionBearing?.length ?? 0).toBeGreaterThan(0);
  });
});
