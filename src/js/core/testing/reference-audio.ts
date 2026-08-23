/**
 * The audio signal the projectM parity references are rendered against.
 *
 * `scripts/native-projectm-capture.cpp` feeds these exact samples to
 * `PCM::addPCMfloat_2ch`, and the capture harness feeds the same samples to
 * our own pipeline, so a parity diff compares two renderers hearing the same
 * thing. Any change here must be mirrored in the C++ harness, and invalidates
 * every certified reference.
 *
 * Three steady tones, one per band of projectM's FFT split (BeatDetect.cpp
 * `ranges1024`: bass below 215Hz, mid to 1981Hz, treble above). The amplitudes
 * are unequal because projectM weights the bands unequally — 100/5, 100/41 and
 * 90/354 — and these values put all three on the same instant energy.
 *
 * That equality is what makes the pairing exact. With a steady signal
 * projectM's `bass_history` converges to `bass_instant` and `vol_history` to
 * the same value, so
 *
 *   bass = E / (1.3*E + 0.2*E) = 2/3
 *
 * on every band, with `bass_att`/`mid_att`/`treb_att`/`vol` converging there
 * too. Our own analyser normalises differently (a constant input converges to
 * 1.0), so the capture path pins the bands to this value rather than trying to
 * reproduce projectM's beat detector.
 */
export const REFERENCE_AUDIO_SAMPLE_RATE = 44100;
export const REFERENCE_AUDIO_SAMPLES_PER_FRAME = 1024;

const BASS_HZ = 110;
const MID_HZ = 880;
const TREB_HZ = 5000;
const BASS_AMP = 0.0707;
const MID_AMP = 0.2025;
const TREB_AMP = 0.627;

/**
 * projectM's converged per-band value for this signal. Derived, not measured:
 * `BeatDetect` keeps `beatDetect` private, so the harness cannot report it.
 */
export const REFERENCE_AUDIO_STEADY_BAND = 2 / 3;

/** One sample of the reference signal, by absolute sample index. */
export function referenceAudioSample(sampleIndex: number) {
  const t = sampleIndex / REFERENCE_AUDIO_SAMPLE_RATE;
  const twoPi = Math.PI * 2;
  return (
    BASS_AMP * Math.sin(twoPi * BASS_HZ * t) +
    MID_AMP * Math.sin(twoPi * MID_HZ * t) +
    TREB_AMP * Math.sin(twoPi * TREB_HZ * t)
  );
}

/**
 * Fill `target` with one frame of the reference signal as MilkDrop waveform
 * bytes — 128 is silence, not 0. Frame `frameIndex` starts at sample
 * `frameIndex * REFERENCE_AUDIO_SAMPLES_PER_FRAME`, matching the harness,
 * which hands projectM one 1024-sample window per rendered frame.
 */
export function fillReferenceAudioWaveform(
  target: Uint8Array,
  frameIndex: number,
) {
  const start = frameIndex * REFERENCE_AUDIO_SAMPLES_PER_FRAME;
  for (let i = 0; i < target.length; i += 1) {
    const sample = referenceAudioSample(start + i);
    const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;
    target[i] = Math.round(128 + clamped * 127);
  }
}
