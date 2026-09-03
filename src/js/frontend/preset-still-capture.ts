/**
 * Remembers real frames of presets, so a tile can show one instead of an
 * invented picture.
 *
 * Most of the catalog has no preview PNG in R2, and the art slot used to fill
 * that gap with a picture generated from a hash of the preset id — a waveform
 * over a bloom, drawn to sit in the slot "exactly as a real thumbnail would".
 * It was decoration wearing a preview's clothes: nothing in it came from the
 * preset, and nothing on the tile said so, so a browse grid mixed real frames
 * and invented ones with no way to tell which was which. A preview that isn't
 * of the thing it previews is worse than none, because the reader can't
 * discount it.
 *
 * What this does instead is keep the frames the app has genuinely rendered.
 * The live tile pool already runs real MilkDrop pipelines for hover audition
 * and for the `?liveTiles` flag; when one of those reaches `live` it has a
 * true frame of that preset on a canvas, and reading it costs one pixel copy.
 * Browsing therefore fills the grid in with real previews as it goes, and a
 * preset nobody has looked at yet honestly says it has no preview.
 *
 * Deliberately not: booting engines for every un-thumbnailed tile just to
 * photograph them. That was the first cut of this change and it is the wrong
 * trade — engine-quality-store.ts puts the cost at ~2ms of vm.step per tick
 * per booted tile, and the pool's capacity shrinks under stage load precisely
 * so browse decoration cannot compete with the renderer the user is watching.
 * Spending that budget to fill tiles nobody asked about inverts it. Measured:
 * it pushed tests/corpus/preset-flash-risk.test.ts from passing to a 60s
 * timeout, because the engines it started starved the stage being measured.
 *
 * `MAX_CAPTURE_CACHE_SIZE` bounds the retained stills, evicting oldest-first:
 * data URLs are large, and this is exactly the "preview cache that only ever
 * grows" that check-cache-bounds.ts exists to catch.
 */
import { encodePresetPreviewImage } from '../milkdrop/preset-preview.ts';

export const MAX_CAPTURE_CACHE_SIZE = 120;

/** presetId -> data URL of a frame that preset actually rendered. */
const captureCache = new Map<string, string>();
/**
 * Presets whose engine reported failure. Holds ids only, at most one per
 * catalog entry, so it is bounded by the catalog rather than by session
 * length. Kept so a tile that cannot render says so instead of implying a
 * preview is still coming.
 */
const unrenderable = new Set<string>();

type StillListener = (presetId: string) => void;
const listeners = new Set<StillListener>();

/** Injectable because the real encoder reads a WebGL drawing buffer, which a
 * DOM test environment has no way to provide. */
export type PresetStillEncoder = (canvas: HTMLCanvasElement) => string;
let encodeStill: PresetStillEncoder = encodePresetPreviewImage;

export function setPresetStillEncoderForTests(
  encoder: PresetStillEncoder | null,
) {
  encodeStill = encoder ?? encodePresetPreviewImage;
}

export function subscribePresetStills(listener: StillListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function announce(presetId: string) {
  for (const listener of listeners) {
    listener(presetId);
  }
}

/**
 * Reads a frame off a tile that is already rendering this preset. No-op if a
 * still is already held, so a tile auditioned repeatedly encodes once.
 */
export function rememberPresetStill(
  presetId: string,
  canvas: HTMLCanvasElement,
): string | null {
  if (captureCache.has(presetId)) {
    return captureCache.get(presetId) ?? null;
  }

  let dataUrl: string | null = null;
  try {
    dataUrl = encodeStill(canvas) || null;
  } catch {
    dataUrl = null;
  }
  if (!dataUrl) {
    return null;
  }

  if (captureCache.size >= MAX_CAPTURE_CACHE_SIZE) {
    const oldest = captureCache.keys().next().value;
    if (oldest !== undefined) {
      captureCache.delete(oldest);
    }
  }
  captureCache.set(presetId, dataUrl);
  unrenderable.delete(presetId);
  announce(presetId);
  return dataUrl;
}

/** The preset's engine could not produce a frame. A settled answer, not a
 * pending one: it is what lets the slot say "No preview". */
export function markPresetUnrenderable(presetId: string) {
  if (captureCache.has(presetId) || unrenderable.has(presetId)) {
    return;
  }
  unrenderable.add(presetId);
  announce(presetId);
}

export function getCapturedPresetStill(presetId: string): string | null {
  return captureCache.get(presetId) ?? null;
}

export function isPresetUnrenderable(presetId: string): boolean {
  return unrenderable.has(presetId);
}

export function getPresetStillCacheSize(): number {
  return captureCache.size;
}

/** Test seam: these caches outlive any one component by design. */
export function resetPresetStillCaptureState() {
  captureCache.clear();
  unrenderable.clear();
  listeners.clear();
}
