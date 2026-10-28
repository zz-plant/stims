/**
 * Real-time harmonic/percussive source *separation of a spectrogram* — HPSS in
 * the Fitzgerald (2010) median-filter formulation.
 *
 * What this is: for each frame of the magnitude spectrum we build two crude
 * estimates of the same frame. A median across TIME (per bin, over the last
 * few frames) suppresses short transients and therefore estimates the
 * *sustained* content; a median across FREQUENCY (per bin, over neighbouring
 * bins of the current frame) suppresses narrow spectral peaks and therefore
 * estimates the *broadband* content. Wiener-style soft masks built from the
 * two estimates split the frame's energy between "harmonic" (sustained,
 * tonal) and "percussive" (transient, broadband).
 *
 * What this is NOT: stem separation. It does not isolate instruments, and it
 * cannot tell a kick from a bass note that started on the same frame — it only
 * measures how transient/broadband versus sustained/tonal the energy in each
 * frequency region is. Names here describe the measurement, never the
 * instrument a listener would infer.
 *
 * Input is the byte spectrum an AnalyserNode produces (dB-mapped, 0..255).
 * That mapping is monotone in level, which is all the masks need; the absolute
 * values are not calibrated magnitudes.
 */

export type HarmonicPercussiveLevels = {
  /** Percussive (transient/broadband) energy, 20 Hz .. `maxHz`, 0..1. */
  percussive: number;
  /** Harmonic (sustained/tonal) energy, 20 Hz .. `maxHz`, 0..1. */
  harmonic: number;
  /** Percussive energy restricted to 20-250 Hz. */
  percussiveLow: number;
  /** Percussive energy restricted to 250-4000 Hz. */
  percussiveMid: number;
  /** Percussive energy restricted to 4000 Hz .. `maxHz`. */
  percussiveHigh: number;
  /**
   * percussive / (percussive + harmonic), 0..1. 0.5 when the frame carries no
   * energy at all, so it never emits NaN and reads "neutral" in silence.
   */
  percussiveRatio: number;
};

export type HarmonicPercussiveOptions = {
  /** Frames of history for the time-median (odd). More = better harmonic
   * estimate, slower to react. 7 frames at 60 fps is ~117 ms. */
  timeFrames?: number;
  /** Bins for the frequency-median (odd). Must be wide enough to smear
   * individual partials but narrow enough to keep broadband detail. */
  freqBins?: number;
  /** Bins above this frequency are ignored; they contribute little and cost
   * the most, since the analyser's linear bins are dense up top. */
  maxHz?: number;
};

const DEFAULT_TIME_FRAMES = 7;
const DEFAULT_FREQ_BINS = 9;
const DEFAULT_MAX_HZ = 12_000;

const LOW_MAX_HZ = 250;
const MID_MAX_HZ = 4_000;

const EMPTY_LEVELS: HarmonicPercussiveLevels = Object.freeze({
  percussive: 0,
  harmonic: 0,
  percussiveLow: 0,
  percussiveMid: 0,
  percussiveHigh: 0,
  percussiveRatio: 0.5,
});

/** Median of the first `count` entries of `scratch`, via insertion sort.
 * Fallback for arbitrary sizes; 7- and 9-element medians route through
 * branchless selection networks below. */
function medianInPlace(scratch: Float32Array, count: number): number {
  for (let i = 1; i < count; i += 1) {
    const value = scratch[i];
    let j = i - 1;
    while (j >= 0 && scratch[j] > value) {
      scratch[j + 1] = scratch[j];
      j -= 1;
    }
    scratch[j + 1] = value;
  }
  const mid = count >> 1;
  return (count & 1) === 1
    ? scratch[mid]
    : (scratch[mid - 1] + scratch[mid]) * 0.5;
}

/** Optimal 9-element median selection network (Paeth 1990 / Devillard 1998,
 * 19 compare-swaps). Evaluated branchlessly via hardware Math.min/Math.max
 * instructions, avoiding CPU branch mispredictions on audio spectrum noise. */
function median9Branchless(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  p4: number,
  p5: number,
  p6: number,
  p7: number,
  p8: number,
): number {
  let t: number;
  t = Math.min(p1, p2);
  p2 = Math.max(p1, p2);
  p1 = t;
  t = Math.min(p4, p5);
  p5 = Math.max(p4, p5);
  p4 = t;
  t = Math.min(p7, p8);
  p8 = Math.max(p7, p8);
  p7 = t;
  t = Math.min(p0, p1);
  p1 = Math.max(p0, p1);
  p0 = t;
  t = Math.min(p3, p4);
  p4 = Math.max(p3, p4);
  p3 = t;
  t = Math.min(p6, p7);
  p7 = Math.max(p6, p7);
  p6 = t;
  t = Math.min(p1, p2);
  p2 = Math.max(p1, p2);
  p1 = t;
  t = Math.min(p4, p5);
  p5 = Math.max(p4, p5);
  p4 = t;
  t = Math.min(p7, p8);
  p8 = Math.max(p7, p8);
  p7 = t;
  p3 = Math.max(p0, p3);
  p5 = Math.min(p5, p8);
  t = Math.min(p4, p7);
  p7 = Math.max(p4, p7);
  p4 = t;
  p6 = Math.max(p3, p6);
  p4 = Math.max(p1, p4);
  p2 = Math.min(p2, p5);
  p4 = Math.min(p4, p7);
  t = Math.min(p4, p2);
  p2 = Math.max(p4, p2);
  p4 = t;
  p4 = Math.max(p6, p4);
  return Math.min(p4, p2);
}

/** Optimal 7-element median selection network (Devillard 1998, 13 compare-swaps).
 * Evaluated branchlessly via hardware Math.min/Math.max instructions. */
function median7Branchless(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  p4: number,
  p5: number,
  p6: number,
): number {
  let t: number;
  t = Math.min(p0, p5);
  p5 = Math.max(p0, p5);
  p0 = t;
  t = Math.min(p0, p3);
  p3 = Math.max(p0, p3);
  p0 = t;
  t = Math.min(p1, p6);
  p6 = Math.max(p1, p6);
  p1 = t;
  t = Math.min(p2, p4);
  p4 = Math.max(p2, p4);
  p2 = t;
  p1 = Math.max(p0, p1);
  t = Math.min(p3, p5);
  p5 = Math.max(p3, p5);
  p3 = t;
  t = Math.min(p2, p6);
  p6 = Math.max(p2, p6);
  p2 = t;
  p3 = Math.max(p2, p3);
  p3 = Math.min(p3, p6);
  p4 = Math.min(p4, p5);
  t = Math.min(p1, p4);
  p4 = Math.max(p1, p4);
  p1 = t;
  p3 = Math.max(p1, p3);
  return Math.min(p3, p4);
}

export function createHarmonicPercussiveAnalyser(
  options: HarmonicPercussiveOptions = {},
) {
  const timeFrames = Math.max(
    1,
    (options.timeFrames ?? DEFAULT_TIME_FRAMES) | 1,
  );
  const freqBins = Math.max(1, (options.freqBins ?? DEFAULT_FREQ_BINS) | 1);
  const maxHz = options.maxHz ?? DEFAULT_MAX_HZ;
  const freqHalf = freqBins >> 1;

  let binCount = 0;
  /** Ring buffer of the last `timeFrames` normalized spectra. */
  let history = new Float32Array(0);
  let historyWrite = 0;
  let historyFilled = 0;
  let percussiveEstimate = new Float32Array(0);
  const timeScratch = new Float32Array(timeFrames);
  const freqScratch = new Float32Array(freqBins);

  const result: HarmonicPercussiveLevels = { ...EMPTY_LEVELS };

  const ensureBuffers = (count: number) => {
    if (binCount === count) {
      return;
    }
    binCount = count;
    history = new Float32Array(count * timeFrames);
    percussiveEstimate = new Float32Array(count);
    historyWrite = 0;
    historyFilled = 0;
  };

  return {
    reset() {
      binCount = 0;
      history = new Float32Array(0);
      percussiveEstimate = new Float32Array(0);
      historyWrite = 0;
      historyFilled = 0;
      Object.assign(result, EMPTY_LEVELS);
    },

    /**
     * @param spectrum Magnitude spectrum in AnalyserNode layout (bin `i` covers
     * `i * sampleRate / fftSize` Hz): a Uint8Array byte spectrum (dB-mapped,
     * 0..255) or a Float32Array already normalized to 0..1.
     * @param sampleRate Audio sample rate in Hz.
     */
    analyse(
      spectrum: Uint8Array | Float32Array,
      sampleRate = 48_000,
    ): HarmonicPercussiveLevels {
      const total = spectrum.length;
      if (total === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
        return Object.assign(result, EMPTY_LEVELS);
      }

      // AnalyserNode hands back fftSize/2 bins spanning DC..nyquist.
      const binHz = sampleRate / 2 / total;
      const usable = Math.max(1, Math.min(total, Math.ceil(maxHz / binHz)));
      ensureBuffers(usable);

      // Write this frame into the history ring. Byte spectra are dB-mapped
      // 0..255; Float32Array inputs are already normalized 0..1.
      const writeOffset = historyWrite * usable;
      if (spectrum instanceof Uint8Array) {
        const inv255 = 1 / 255;
        for (let i = 0; i < usable; i += 1) {
          history[writeOffset + i] = spectrum[i]! * inv255;
        }
      } else {
        history.set(spectrum.subarray(0, usable), writeOffset);
      }
      historyWrite = (historyWrite + 1) % timeFrames;
      historyFilled = Math.min(timeFrames, historyFilled + 1);

      // Percussive estimate: median across frequency of the current frame.
      // Interior bins run through a branchless 9-element median network with
      // direct register access, avoiding scratch copies and branch mispredicts.
      if (freqBins === 9 && usable >= 9) {
        for (let i = 0; i < 4; i += 1) {
          for (let k = 0; k < 9; k += 1) {
            freqScratch[k] = history[writeOffset + Math.max(0, i + k - 4)] ?? 0;
          }
          percussiveEstimate[i] = median9Branchless(
            freqScratch[0] ?? 0,
            freqScratch[1] ?? 0,
            freqScratch[2] ?? 0,
            freqScratch[3] ?? 0,
            freqScratch[4] ?? 0,
            freqScratch[5] ?? 0,
            freqScratch[6] ?? 0,
            freqScratch[7] ?? 0,
            freqScratch[8] ?? 0,
          );
        }
        const interiorEnd = usable - 4;
        for (let i = 4; i < interiorEnd; i += 1) {
          const base = writeOffset + i;
          percussiveEstimate[i] = median9Branchless(
            history[base - 4] ?? 0,
            history[base - 3] ?? 0,
            history[base - 2] ?? 0,
            history[base - 1] ?? 0,
            history[base] ?? 0,
            history[base + 1] ?? 0,
            history[base + 2] ?? 0,
            history[base + 3] ?? 0,
            history[base + 4] ?? 0,
          );
        }
        for (let i = interiorEnd; i < usable; i += 1) {
          for (let k = 0; k < 9; k += 1) {
            freqScratch[k] =
              history[writeOffset + Math.min(usable - 1, i + k - 4)] ?? 0;
          }
          percussiveEstimate[i] = median9Branchless(
            freqScratch[0] ?? 0,
            freqScratch[1] ?? 0,
            freqScratch[2] ?? 0,
            freqScratch[3] ?? 0,
            freqScratch[4] ?? 0,
            freqScratch[5] ?? 0,
            freqScratch[6] ?? 0,
            freqScratch[7] ?? 0,
            freqScratch[8] ?? 0,
          );
        }
      } else {
        for (let i = 0; i < usable; i += 1) {
          for (let k = 0; k < freqBins; k += 1) {
            const index = Math.min(
              usable - 1,
              Math.max(0, i + k - freqHalf), // clamp at the edges
            );
            freqScratch[k] = history[writeOffset + index] ?? 0;
          }
          percussiveEstimate[i] = medianInPlace(freqScratch, freqBins);
        }
      }

      const lowEnd = Math.min(usable, Math.ceil(LOW_MAX_HZ / binHz));
      const midEnd = Math.min(usable, Math.ceil(MID_MAX_HZ / binHz));
      let percussiveSum = 0;
      let harmonicSum = 0;
      let lowSum = 0;
      let midSum = 0;
      let highSum = 0;
      let lowBins = 0;
      let midBins = 0;
      let highBins = 0;
      const u2 = usable * 2;
      const u3 = usable * 3;
      const u4 = usable * 4;
      const u5 = usable * 5;
      const u6 = usable * 6;

      for (let i = 0; i < usable; i += 1) {
        // Harmonic estimate: median across time for this bin. Steady-state
        // history (7 frames) routes through the branchless 7-element network.
        let harmonicEstimate: number;
        if (timeFrames === 7 && historyFilled === 7) {
          harmonicEstimate = median7Branchless(
            history[i] ?? 0,
            history[usable + i] ?? 0,
            history[u2 + i] ?? 0,
            history[u3 + i] ?? 0,
            history[u4 + i] ?? 0,
            history[u5 + i] ?? 0,
            history[u6 + i] ?? 0,
          );
        } else {
          for (let t = 0; t < historyFilled; t += 1) {
            timeScratch[t] = history[t * usable + i] ?? 0;
          }
          harmonicEstimate = medianInPlace(timeScratch, historyFilled);
        }
        const percussive = percussiveEstimate[i];
        const magnitude = history[writeOffset + i];

        const hSquared = harmonicEstimate * harmonicEstimate;
        const pSquared = percussive * percussive;
        const denominator = hSquared + pSquared;
        // Below this the bin is silence/noise floor; contribute nothing rather
        // than dividing by ~0.
        let harmonicPart = 0;
        let percussivePart = 0;
        if (denominator > 1e-9) {
          const factor = magnitude / denominator;
          harmonicPart = factor * hSquared;
          percussivePart = factor * pSquared;
        }

        harmonicSum += harmonicPart;
        percussiveSum += percussivePart;
        if (i < lowEnd) {
          lowSum += percussivePart;
          lowBins += 1;
        } else if (i < midEnd) {
          midSum += percussivePart;
          midBins += 1;
        } else {
          highSum += percussivePart;
          highBins += 1;
        }
      }

      result.percussive = percussiveSum / usable;
      result.harmonic = harmonicSum / usable;
      result.percussiveLow = lowBins > 0 ? lowSum / lowBins : 0;
      result.percussiveMid = midBins > 0 ? midSum / midBins : 0;
      result.percussiveHigh = highBins > 0 ? highSum / highBins : 0;
      const combined = percussiveSum + harmonicSum;
      result.percussiveRatio = combined > 1e-9 ? percussiveSum / combined : 0.5;
      return result;
    },
  };
}
