/**
 * The per-sample fields one read of a frame produces. Separate from the
 * sampler so the worker can fill them without importing the sampler, whose
 * `new Worker(new URL(...))` a bundler would follow from inside the worker.
 */
import {
  isSaturatedRed,
  LINEAR_CHANNEL_LUT,
  redFlashValue,
} from './thresholds.ts';

/** A luminance field and the red-flash field read from the same pixels. */
export type SampledFields = {
  luminance: Float32Array;
  red: { values: Float32Array; saturated: Uint8Array };
};

export function createFields(count: number): SampledFields {
  return {
    luminance: new Float32Array(count),
    red: { values: new Float32Array(count), saturated: new Uint8Array(count) },
  };
}

export function fillFields(target: SampledFields, pixels: Uint8ClampedArray) {
  const { luminance, red } = target;
  const redValues = red.values;
  const redSaturated = red.saturated;
  const len = luminance.length;
  let idx = 0;
  for (let i = 0; i < len; i += 1) {
    const r = pixels[idx] as number;
    const g = pixels[idx + 1] as number;
    const b = pixels[idx + 2] as number;
    idx += 4;
    luminance[i] =
      0.2126 * (LINEAR_CHANNEL_LUT[r] as number) +
      0.7152 * (LINEAR_CHANNEL_LUT[g] as number) +
      0.0722 * (LINEAR_CHANNEL_LUT[b] as number);
    redValues[i] = redFlashValue(r, g, b);
    redSaturated[i] = isSaturatedRed(r, g, b) ? 1 : 0;
  }
  return target;
}
