/**
 * Shared signal source — one persistent analyser over whatever audio the
 * instrument is currently playing.
 *
 * `listen()` originally built an AudioContext per call and threw it away.
 * That is fine for a one-shot measurement and useless for modulation, which
 * needs band values every frame: a per-frame context would be absurd, and a
 * per-call one cannot carry the envelope state a follower needs between
 * frames. So the analyser lives here, is created on first use, and is shared
 * by the measurement path and the modulation loop.
 *
 * Kept separate from live-performance.ts so the modulation engine can read
 * audio without importing the gesture/macro machinery.
 */

import { peekStrudelBridge } from './strudel-audio-bridge.ts';

export interface SignalBands {
  rms: number;
  bass: number;
  mid: number;
  treble: number;
}

export const SILENT_BANDS: SignalBands = { rms: 0, bass: 0, mid: 0, treble: 0 };

export type BandName = keyof SignalBands;

interface Rig {
  context: AudioContext;
  analyser: AnalyserNode;
  stream: MediaStream;
  // Explicit ArrayBuffer: the analyser's read methods reject the wider
  // ArrayBufferLike default that a bare Float32Array annotation implies.
  time: Float32Array<ArrayBuffer>;
  freq: Uint8Array<ArrayBuffer>;
}

let attached: MediaStream | null = null;
let rig: Rig | null = null;

/** Point the analyser at a specific stream; null clears the override. */
export function attachStream(stream: MediaStream | null): void {
  if (stream === attached) return;
  attached = stream;
  teardown();
}

/**
 * The stream to measure: an explicit attachment first, else whatever Strudel
 * is playing. Returns null when nothing is producing audio, which callers
 * must report rather than paper over with a zero.
 */
function resolveStream(): MediaStream | null {
  const candidate = attached ?? peekStrudelBridge()?.stream ?? null;
  return candidate?.getAudioTracks().length ? candidate : null;
}

function teardown(): void {
  if (!rig) return;
  const closing = rig.context;
  rig = null;
  void closing.close().catch(() => {
    // Closing races with a page teardown often enough that throwing here
    // would turn a harmless unmount into a console error.
  });
}

/** Build the analyser if audio exists. Returns null when nothing is playing. */
function ensureRig(): Rig | null {
  const stream = resolveStream();
  if (!stream) {
    teardown();
    return null;
  }
  if (rig && rig.stream === stream) {
    // An AudioContext created without a user gesture can start (or become)
    // suspended, and a suspended analyser returns all zeros — indistinguishable
    // from silence, which is the one confusion this module exists to prevent.
    if (rig.context.state === 'suspended') void rig.context.resume();
    return rig;
  }
  teardown();

  const context = new AudioContext();
  if (context.state === 'suspended') void context.resume();
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  // Low smoothing: a follower wants the transient, not a slow average. The
  // per-modulator attack/release does the shaping instead.
  analyser.smoothingTimeConstant = 0.2;
  context.createMediaStreamSource(stream).connect(analyser);

  rig = {
    context,
    analyser,
    stream,
    time: new Float32Array(analyser.fftSize),
    freq: new Uint8Array(analyser.frequencyBinCount),
  };
  return rig;
}

export function hasLiveSignal(): boolean {
  return resolveStream() !== null;
}

/**
 * Current band levels, 0-1, or null when no audio is playing. Null rather
 * than zeros so a caller can tell "silent" from "nothing attached" — the
 * distinction the old snapshot telemetry could not express.
 */
export function readBands(): SignalBands | null {
  const active = ensureRig();
  if (!active) return null;

  active.analyser.getFloatTimeDomainData(active.time);
  active.analyser.getByteFrequencyData(active.freq);

  let sumSquares = 0;
  for (const value of active.time) sumSquares += value * value;

  return {
    rms: Math.sqrt(sumSquares / active.time.length),
    bass: bandMean(active.freq, 0, 0.08),
    mid: bandMean(active.freq, 0.08, 0.35),
    treble: bandMean(active.freq, 0.35, 1),
  };
}

function bandMean(freq: Uint8Array, lo: number, hi: number): number {
  const start = Math.floor(freq.length * lo);
  const end = Math.max(start + 1, Math.floor(freq.length * hi));
  let total = 0;
  for (let i = start; i < end; i += 1) total += freq[i] ?? 0;
  return total / (end - start) / 255;
}

/** Drop the analyser; the next read rebuilds it. */
export function releaseSignal(): void {
  teardown();
}
