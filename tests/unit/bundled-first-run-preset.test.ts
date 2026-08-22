import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  FIRST_RUN_EVIDENCE_PATH,
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
 * The default has now been wrong twice for the same reason — chosen on a
 * proxy (curated sort order, then a count of audio-reading variables) that
 * did not predict what the visitor sees. These thresholds are the product
 * requirement stated numerically, checked against evidence recorded by
 * `bun run generate:first-run-evidence`, so the next change to
 * FIRST_RUN_PRESET_ID has to come with a measurement.
 *
 * They are set well clear of the run-to-run variance of `lab:visual` (repeat
 * runs of the shipped preset put mean luminance at 33-46 and ΔL at -17 to
 * -25) and well above the preset they replaced (ΔL -1.9, motion ratio 0.93).
 */
const EVIDENCE_BAR = {
  /** Below this the frame is too dark to be the product's first impression. */
  minMeanLuminance: 25,
  /** Below this the frame is a few lit pixels on black, not an image. */
  minVisiblePixelRatio: 0.3,
  /**
   * Either of these clears "the visuals move to what you're listening to":
   * audio changes the frame's brightness, or it changes how much of the
   * frame is moving. One of them must hold on the production backend.
   */
  minLuminanceDelta: 8,
  minMotionRatioDelta: 0.12,
} as const;

/** WebGPU is what production selects wherever it is available. */
const PRODUCTION_BACKEND = 'webgpu';

describe('first-run preset evidence', () => {
  const evidence = JSON.parse(
    fs.readFileSync(FIRST_RUN_EVIDENCE_PATH, 'utf8'),
  ) as {
    presetId: string;
    presetSha256: string;
    backends: Record<
      string,
      {
        meanLuminance: number;
        visiblePixelRatio: number;
        nearBlackFrameRatio: number;
        luminanceDelta: number;
        audioMotionRatio: number;
      }
    >;
    reactivity?: {
      motionBearing: Array<{ variable: string; correlation: number }>;
    };
  };

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

  test('is measured on both backends', () => {
    expect(Object.keys(evidence.backends).sort()).toEqual(['webgl', 'webgpu']);
  });

  test('is bright enough to look at on both backends', () => {
    for (const [backend, measured] of Object.entries(evidence.backends)) {
      expect(
        measured.meanLuminance,
        `${backend} mean luminance`,
      ).toBeGreaterThanOrEqual(EVIDENCE_BAR.minMeanLuminance);
      expect(
        measured.visiblePixelRatio,
        `${backend} visible pixels`,
      ).toBeGreaterThanOrEqual(EVIDENCE_BAR.minVisiblePixelRatio);
      expect(measured.nearBlackFrameRatio, `${backend} near-black`).toBe(0);
    }
  });

  test('visibly answers to audio on the production backend', () => {
    const measured = evidence.backends[PRODUCTION_BACKEND];
    expect(measured).toBeDefined();
    if (!measured) return;

    const brightnessResponse = Math.abs(measured.luminanceDelta);
    const motionResponse = Math.abs(1 - measured.audioMotionRatio);

    // Deliberately an OR: a preset may answer the music by changing what is
    // lit or by changing how much moves, and either one is visible.
    expect(
      brightnessResponse >= EVIDENCE_BAR.minLuminanceDelta ||
        motionResponse >= EVIDENCE_BAR.minMotionRatioDelta,
    ).toBe(true);
  });

  test('drives at least one variable the whole frame moves with', () => {
    // The trap that produced the last default: eight "reactive" variables,
    // none of which moved the picture. q-vars and wave deviation do not
    // count here — zoom, rot, warp, sx, sy, cx, cy, dx, dy and decay do.
    expect(evidence.reactivity?.motionBearing?.length ?? 0).toBeGreaterThan(0);
  });
});
