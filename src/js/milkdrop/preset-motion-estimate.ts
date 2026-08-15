import type { MilkdropCompiledPreset } from './types';

/**
 * How much a preset moves, estimated from its compiled fields.
 *
 * The catalog side of the visual search is described from a rendered preview,
 * which is a still — it carries palette and edge structure but no motion at
 * all. Motion is the one axis of `describeFrame`'s vocabulary a single frame
 * cannot supply, so it comes from the preset instead.
 *
 * The output is deliberately on the same 0..1-ish scale as the frame-to-frame
 * `motionEstimate` in visual-embedding.ts, because both feed the same
 * `motionDescription` thresholds. It is an estimate of visible movement, not
 * a physical quantity.
 */
export function estimatePresetMotion(compiled: MilkdropCompiledPreset): number {
  const fields = compiled.ir.numericFields;
  const read = (key: string, fallback: number) => {
    const value = fields[key];
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : fallback;
  };

  // Distance of the per-frame transform from identity. Zoom is multiplicative
  // so it is measured as a ratio; the rest are already offsets.
  const zoom = Math.abs(Math.log(Math.max(0.01, read('zoom', 1))));
  const rot = Math.abs(read('rot', 0));
  const drift = Math.abs(read('dx', 0)) + Math.abs(read('dy', 0));
  const stretch =
    Math.abs(Math.log(Math.max(0.01, read('sx', 1)))) +
    Math.abs(Math.log(Math.max(0.01, read('sy', 1))));
  const warp = Math.abs(read('warp', 0)) * Math.abs(read('warpanimspeed', 1));

  // A preset whose equations rewrite the transform every frame is moving even
  // when its literal fields look like identity — which is most of the
  // interesting catalog, so treating those as static would be badly wrong.
  const perFrame = compiled.ir.programs.perFrame.sourceLines.join('\n');
  const animated =
    /\b(?:time|bass|mid|treb|bass_att|mid_att|treb_att|beat_pulse)\b/u.test(
      perFrame,
    )
      ? 0.02
      : 0;

  const raw =
    zoom * 0.12 +
    rot * 0.05 +
    drift * 0.15 +
    stretch * 0.05 +
    warp * 0.004 +
    animated;

  return Math.min(1, raw);
}
