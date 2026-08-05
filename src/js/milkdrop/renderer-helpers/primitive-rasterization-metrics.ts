export const MILKDROP_SEGMENT_WIDTH_UNITS = 0.0025;
export const MILKDROP_THICK_WAVE_BASE_OFFSET = 1 / 512;
export const MILKDROP_THICK_SHAPE_PASS_OFFSET = 1 / 1024;
export const MILKDROP_WAVE_Z = 0.24;
export const MILKDROP_CUSTOM_WAVE_Z = 0.28;

export function getMilkdropSegmentWidth(
  thickness: number,
  renderScale: number = 1.0,
) {
  const scaleAdjust = Math.max(0.25, Math.min(2.0, renderScale));
  return (MILKDROP_SEGMENT_WIDTH_UNITS / scaleAdjust) * Math.max(1, thickness);
}

export function getMilkdropThickWaveSpread(
  thickness: number,
  renderScale: number = 1.0,
) {
  const scaleAdjust = Math.max(0.25, Math.min(2.0, renderScale));
  return (
    (MILKDROP_THICK_WAVE_BASE_OFFSET / scaleAdjust) *
    Math.max(1, thickness * 1.5)
  );
}
