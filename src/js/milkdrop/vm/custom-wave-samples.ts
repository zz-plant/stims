/**
 * MilkDrop's `value1`/`value2` for custom waves — the two audio-channel samples
 * a per-point block reads, with MilkDrop's separation, stride, smoothing and
 * scaling applied.
 *
 * Structure comes from Butterchurn 2.6.7's `CustomWaveform.generateWaveform`
 * (`node_modules/butterchurn/lib/butterchurn.js`, which ships unminified and is
 * a direct MilkDrop port). The two SCALE CONSTANTS come from projectM instead,
 * measured 2026-09-01 — Butterchurn's are wrong for our oracle by a factor of
 * ~411 on the spectrum path. See the measurement note below before touching
 * them.
 */

import { buildTwiddleTable, fft } from '../../utils/audio/fft';
import type { MilkdropRuntimeSignals } from '../types';

/** MilkDrop's custom-wave arrays are 512 long; a wave cannot ask for more. */
export const MILKDROP_WAVE_ARRAY_LENGTH = 512;

/**
 * The FFT the spectrum scale is calibrated against. Butterchurn transforms
 * 1024 signed samples into 512 bins, and a bin's magnitude scales with the
 * transform length, so this has to stay pinned to whatever
 * PROJECTM_SPECTRUM_SCALE was measured with — shortening it would silently
 * halve every spectrum value.
 */
const SPECTRUM_FFT_SIZE = 1024;

/**
 * Measured against native projectM on 2026-09-01, not derived from a renderer's
 * source (three previous attempts to derive a constant that way were wrong —
 * see the parity measurement-traps note). Method: a probe preset whose
 * per-point block writes the value to screen position
 * (`x = sample; y = 0.05 + min(value2*k,1)*0.9`), captured through
 * `parity:capture:projectm-native --audio tones` and decoded per image column.
 * Brackets at k=1/5/10 agreed to within 1.6% (0.0742 / 0.0751 / 0.0754).
 *
 * Butterchurn uses 0.004 and 0.15 here; neither survived contact with the
 * measurement. The waveform constant reproduces projectM's +-0.215 to within
 * 3%. The spectrum constant is calibrated against projectM's peak of 0.0751
 * for the reference tones, on top of the weighting chosen below.
 *
 * Known residual: at `smoothing = 0.9` projectM flattens the peak to 0.230 of
 * its unsmoothed value and this code reaches 0.139 — Butterchurn's
 * `sqrt(smoothing * 0.98)` smooths somewhat harder than projectM. Left alone
 * deliberately rather than fitted, because one probe point cannot pin a second
 * free parameter and the two agree closely at the low smoothing values most
 * presets use.
 */
const PROJECTM_WAVEFORM_SCALE = 0.002;
const PROJECTM_SPECTRUM_SCALE = 1.256e-4;

/**
 * Butterchurn multiplies by the preset's `wave_scale` as well. projectM does
 * NOT: doubling `fWaveScale` produced a pixel-identical capture, while doubling
 * the wave's own `scaling` doubled the values (x2.007). Only `scaling` applies.
 */

/**
 * Butterchurn's FFT is built with `equalize` on, multiplying bin i by
 * `-0.02 * ln((512 - i)/512)` — near zero at the bottom, ~0.125 at the top.
 * projectM's tilt runs the OTHER way. Decoding the probe curve bin-for-bin and
 * correlating candidate weightings against it (2026-09-01):
 *
 *   reversed  -0.02*ln((i+1)/512)   corr 0.851
 *   1/sqrt(i+1)                     corr 0.860
 *   none (raw magnitude)            corr 0.628
 *   Butterchurn's own               corr 0.356
 *
 * The first two are indistinguishable on this signal — three steady tones give
 * only three constraints. This takes the reversed table because it has a
 * mechanism behind it (the same MilkDrop table, indexed from the other end)
 * rather than being a curve fit, but it IS a fit: to separate them, probe
 * against a broadband signal, which needs a new audio mode in the capture
 * harness (the reference tones cannot change without invalidating every
 * certified reference).
 *
 * What is NOT in doubt: the tilt exists and it boosts lows. Both Butterchurn's
 * table and no weighting at all are decisively worse.
 */
const EQUALIZE = (() => {
  const table = new Float32Array(MILKDROP_WAVE_ARRAY_LENGTH);
  for (let i = 0; i < MILKDROP_WAVE_ARRAY_LENGTH; i += 1) {
    table[i] = -0.02 * Math.log((i + 1) / MILKDROP_WAVE_ARRAY_LENGTH);
  }
  return table;
})();

export type MilkdropWaveChannels = {
  /** Signed time-domain samples in MilkDrop's +-128 byte units. */
  timeL: Float32Array;
  timeR: Float32Array;
  /** Equalized FFT magnitudes, same units the scale constant assumes. */
  freqL: Float32Array;
  freqR: Float32Array;
};

type ChannelScratch = MilkdropWaveChannels & {
  signedL: Float32Array;
  signedR: Float32Array;
  real: Float32Array;
  imag: Float32Array;
  twiddles: ReturnType<typeof buildTwiddleTable>;
  /**
   * Cache identity. The frame counter alone is not enough: two engine
   * instances (preset blending, the live tile pool) step the same frame number
   * with different signal objects, and keying on the number alone would hand
   * the second one the first one's audio.
   */
  frameKey: number;
  frameSource: object | null;
  spectrumFrameKey: number;
};

let scratch: ChannelScratch | null = null;

function getScratch(): ChannelScratch {
  scratch ??= {
    timeL: new Float32Array(MILKDROP_WAVE_ARRAY_LENGTH),
    timeR: new Float32Array(MILKDROP_WAVE_ARRAY_LENGTH),
    freqL: new Float32Array(MILKDROP_WAVE_ARRAY_LENGTH),
    freqR: new Float32Array(MILKDROP_WAVE_ARRAY_LENGTH),
    signedL: new Float32Array(SPECTRUM_FFT_SIZE),
    signedR: new Float32Array(SPECTRUM_FFT_SIZE),
    real: new Float32Array(SPECTRUM_FFT_SIZE),
    imag: new Float32Array(SPECTRUM_FFT_SIZE),
    twiddles: buildTwiddleTable(SPECTRUM_FFT_SIZE),
    frameKey: Number.NaN,
    frameSource: null,
    spectrumFrameKey: Number.NaN,
  };
  return scratch;
}

/**
 * Resolve the signed +-128 waveform for one channel, falling back to the mono
 * buffer when the capture path has no stereo split (the deterministic parity
 * harness fills only `waveformData`).
 */
/**
 * A byte buffer of all zeros means nothing ever wrote to it — the capture
 * path allocates one per frame and only some scenarios fill it. Read as PCM it
 * would be -128 on every sample, i.e. a full-scale DC spike, so treat it as
 * absent. Silence is 128 in a byte buffer and 0 in a float one, both of which
 * this accepts.
 */
function hasSignal(buffer: ArrayLike<number>, offset: number) {
  if (offset === 0) {
    return true;
  }
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] !== 0) {
      return true;
    }
  }
  return false;
}

function fillSignedChannel(
  target: Float32Array,
  signals: MilkdropRuntimeSignals,
  channel: 'left' | 'right',
) {
  const float =
    channel === 'left'
      ? signals.waveformFloatDataL
      : signals.waveformFloatDataR;
  const byte =
    channel === 'left' ? signals.waveformDataL : signals.waveformDataR;
  const stereo = float?.length ? float : byte?.length ? byte : null;
  // Float PCM is +-1 and byte PCM is centred on 128; both end up in +-128.
  const [buffer, offset, gain] = stereo
    ? stereo === float
      ? [stereo, 0, 127]
      : [stereo, 128, 1]
    : signals.waveformFloatData?.length
      ? [signals.waveformFloatData, 0, 127]
      : signals.waveformData?.length
        ? [signals.waveformData, 128, 1]
        : [null, 0, 0];
  target.fill(0);
  if (!buffer || !hasSignal(buffer, offset)) {
    return 0;
  }
  // Copied one-for-one and zero-padded, never resampled: stretching a short
  // buffer across the window would halve every frequency, which is exactly
  // what a 512 -> 1024 interpolation did on the first attempt.
  const count = Math.min(buffer.length, target.length);
  for (let i = 0; i < count; i += 1) {
    target[i] = ((buffer[i] ?? offset) - offset) * gain;
  }
  return count;
}

function fillMagnitudes(
  target: Float32Array,
  signed: Float32Array,
  s: ChannelScratch,
) {
  s.real.set(signed);
  s.imag.fill(0);
  fft(s.real, s.imag, s.twiddles);
  for (let i = 0; i < MILKDROP_WAVE_ARRAY_LENGTH; i += 1) {
    const re = s.real[i];
    const im = s.imag[i];
    target[i] = Math.sqrt(re * re + im * im) * EQUALIZE[i];
  }
}

/**
 * Per-frame channel arrays, cached on the frame counter: every custom wave in a
 * preset reads the same audio, and the FFT is the expensive part.
 */
export function getMilkdropWaveChannels(
  signals: MilkdropRuntimeSignals,
  needsSpectrum: boolean,
): MilkdropWaveChannels {
  const s = getScratch();
  const frameKey = signals.frame;
  if (s.frameKey !== frameKey || s.frameSource !== signals) {
    s.frameKey = frameKey;
    s.frameSource = signals;
    const countL = fillSignedChannel(s.signedL, signals, 'left');
    const countR = fillSignedChannel(s.signedR, signals, 'right');
    if (countR === 0 || countL === 0) {
      // Mono source: both channels carry the same signal, which is what the
      // deterministic parity harness feeds.
      s.signedR.set(s.signedL);
    }
    const available = Math.max(1, countL || countR);
    // MilkDrop's time array is 512 long whatever the buffer holds, each entry
    // averaged with its predecessor the way Butterchurn undersamples.
    const stride = available / MILKDROP_WAVE_ARRAY_LENGTH;
    for (let j = 0; j < MILKDROP_WAVE_ARRAY_LENGTH; j += 1) {
      const i = Math.min(available - 1, Math.floor(j * stride));
      const previous = i > 0 ? i - 1 : 0;
      s.timeL[j] = 0.5 * (s.signedL[i] + s.signedL[previous]);
      s.timeR[j] = 0.5 * (s.signedR[i] + s.signedR[previous]);
    }
    s.spectrumFrameKey = Number.NaN;
  }
  if (needsSpectrum && s.spectrumFrameKey !== frameKey) {
    s.spectrumFrameKey = frameKey;
    fillMagnitudes(s.freqL, s.signedL, s);
    fillMagnitudes(s.freqR, s.signedR, s);
  }
  return s;
}

export type CustomWaveSampleOptions = {
  sampleCount: number;
  separation: number;
  spectrum: boolean;
  scaling: number;
  smoothing: number;
};

/**
 * Fill `value1`/`value2` for one custom wave, following MilkDrop's own
 * arithmetic: separation-offset reads, a stride across the spectrum, a forward
 * then BACKWARD smoothing pass (which is why this cannot be done one point at a
 * time), and finally the scale.
 */
export function fillCustomWaveSampleValues(
  channels: MilkdropWaveChannels,
  options: CustomWaveSampleOptions,
  value1: Float32Array,
  value2: Float32Array,
) {
  const { spectrum, separation, scaling, smoothing } = options;
  const count = Math.min(options.sampleCount, value1.length, value2.length);
  if (count <= 0) {
    return 0;
  }
  const left = spectrum ? channels.freqL : channels.timeL;
  const right = spectrum ? channels.freqR : channels.timeR;
  const j0 = spectrum
    ? 0
    : Math.floor((MILKDROP_WAVE_ARRAY_LENGTH - count) / 2 - separation / 2);
  const j1 = spectrum
    ? 0
    : Math.floor((MILKDROP_WAVE_ARRAY_LENGTH - count) / 2 + separation / 2);
  const step = spectrum ? (MILKDROP_WAVE_ARRAY_LENGTH - separation) / count : 1;
  const mix1 = Math.sqrt(Math.max(0, smoothing) * 0.98);
  const mix2 = 1 - mix1;

  const read = (source: Float32Array, index: number) =>
    source[Math.min(MILKDROP_WAVE_ARRAY_LENGTH - 1, Math.max(0, index))] ?? 0;

  value1[0] = read(left, j0);
  value2[0] = read(right, j1);
  for (let j = 1; j < count; j += 1) {
    value1[j] =
      read(left, Math.floor(j * step + j0)) * mix2 + value1[j - 1] * mix1;
    value2[j] =
      read(right, Math.floor(j * step + j1)) * mix2 + value2[j - 1] * mix1;
  }
  for (let j = count - 2; j >= 0; j -= 1) {
    value1[j] = value1[j] * mix2 + value1[j + 1] * mix1;
    value2[j] = value2[j] * mix2 + value2[j + 1] * mix1;
  }

  const scale =
    (spectrum ? PROJECTM_SPECTRUM_SCALE : PROJECTM_WAVEFORM_SCALE) * scaling;
  for (let j = 0; j < count; j += 1) {
    value1[j] *= scale;
    value2[j] *= scale;
  }
  return count;
}
