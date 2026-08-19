/**
 * Shared trace-capture primitives for the deterministic VM replay harness.
 *
 * Three consumers must agree byte-for-byte on the digest of a frame:
 *   - scripts/preset-lab-replay.ts (headless CPU record/replay CLI)
 *   - src/js/milkdrop/runtime/trace-recorder.ts (live browser capture,
 *     agent mode)
 *   - the in-page GPU-tier replay (lab:replay --tier gpu evaluates this
 *     module inside a Playwright WebGPU page)
 * so the capture/digest logic lives here, browser-safe (no node imports).
 */

export type FrameInputs = {
  time: number;
  deltaMs: number;
  /** Spectrum/waveform bytes; stored as plain arrays for JSON portability. */
  frequencyData: number[];
  waveformData: number[];
  /**
   * Live captures only: the fully merged signal environment the VM actually
   * stepped with (tracker output + aspect/pixels + interaction overrides).
   * Headless replay cannot reconstruct these from the raw bytes — the live
   * tracker carries pre-recording smoothing state and the frame loop merges
   * viewport/input signals — so when present, replay feeds them to the VM
   * directly and skips the signal tracker.
   */
  signals?: Record<string, number | boolean>;
  /**
   * Live captures only: the effective VM detail scale (quality preset x
   * adaptive density) the frame stepped with. Wave/mesh sample counts derive
   * from it, so replay must restore it before each step.
   */
  detailScale?: number;
  /**
   * Live captures only: every other typed-array field the merged signals
   * carried (float waveform, stereo L/R spectra…), keyed by signal name.
   * Wave building prefers these over the byte buffers, so replay must
   * reattach them or it silently takes a different sampling path.
   */
  arrays?: Record<string, { type: 'u8' | 'f32'; values: number[] }>;
};

/** Rebuilds typed arrays recorded via FrameInputs.arrays. */
export function reviveInputArrays(
  arrays: NonNullable<FrameInputs['arrays']>,
): Record<string, Uint8Array | Float32Array> {
  const out: Record<string, Uint8Array | Float32Array> = {};
  for (const key of Object.keys(arrays)) {
    const entry = arrays[key] as { type: 'u8' | 'f32'; values: number[] };
    out[key] =
      entry.type === 'u8'
        ? new Uint8Array(entry.values)
        : new Float32Array(entry.values);
  }
  return out;
}

export type FrameCapture = {
  /** FNV-1a digest over sorted variables + geometry. */
  digest: string;
  /** Full variable snapshot, kept so divergences can be named precisely.
   * Compact (golden) traces keep it only on checkpoint frames. */
  variables?: Record<string, number>;
  geometry?: { mainWave: number; customWaves: number; shapes: number };
};

export type TraceFile = {
  version: 1;
  presetId: string;
  capturedAt: string;
  fps: number;
  scenario: string;
  frameCount: number;
  /** Raw recorded inputs; null for synthetic traces, whose inputs are
   * regenerated from (scenario, frameCount) on replay. Live browser
   * captures must always store inputs. */
  inputs: FrameInputs[] | null;
  frames: FrameCapture[];
  /** 'live' when recorded from a real browser session (frames carry
   * per-frame `signals`); absent/'synthetic' for lab recordings. */
  source?: 'synthetic' | 'live';
  /**
   * Live captures: the render backend the session ran on. Frame output
   * depends on it — WebGPU sessions emit procedural wave/mesh descriptors
   * and leave the CPU-visual position arrays empty — so replay must
   * configure the VM identically. Absent = 'webgl' (the headless default).
   */
  backend?: 'webgl' | 'webgpu';
  /** Live captures: the WebGPU optimization flags active during recording
   * (they gate the procedural descriptor routing above). */
  webgpuFlags?: Record<string, boolean>;
};

export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function positionsChecksum(positions: ArrayLike<number>): number {
  let sum = 0;
  for (let index = 0; index < positions.length; index += 1) {
    const value = positions[index] as number;
    if (Number.isFinite(value)) {
      sum += value * (1 + (index % 7));
    }
  }
  // Round so a JSON round-trip of the checksum compares exactly.
  return Math.round(sum * 1e6) / 1e6;
}

export function captureFrame(frameState: {
  variables: Record<string, unknown>;
  mainWave: { positions: ArrayLike<number> };
  customWaves: Array<{ positions: ArrayLike<number> }>;
  shapes: Array<{ x: number; y: number; radius: number; rotation: number }>;
}): FrameCapture {
  const variables: Record<string, number> = {};
  for (const key of Object.keys(frameState.variables).sort()) {
    const value = frameState.variables[key];
    if (typeof value === 'number') {
      variables[key] = value;
    }
  }
  let shapesSum = 0;
  for (const shape of frameState.shapes) {
    shapesSum += shape.x + shape.y * 3 + shape.radius * 7 + shape.rotation;
  }
  let customWavesSum = 0;
  for (const wave of frameState.customWaves) {
    customWavesSum += positionsChecksum(wave.positions);
  }
  const geometry = {
    mainWave: positionsChecksum(frameState.mainWave.positions),
    customWaves: Math.round(customWavesSum * 1e6) / 1e6,
    shapes: Math.round(shapesSum * 1e6) / 1e6,
  };
  const digest = fnv1a(JSON.stringify([variables, geometry]));
  return { digest, variables, geometry };
}
