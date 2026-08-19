/**
 * Live trace capture (agent mode): records the real analyser's per-frame
 * inputs plus the exact merged signal environment the VM stepped with, and
 * exports the same TraceFile JSON the headless lab:replay CLI consumes — so
 * a bug seen in a real session replays deterministically without a browser:
 *
 *   const dbg = window.__milkdropRuntimeDebug;
 *   dbg.startTraceCapture();          // resets the VM (visual hiccup, by design)
 *   …reproduce the bug…
 *   const trace = dbg.stopTraceCapture();
 *   // save JSON, then: bun run lab:replay -- --replay trace.json
 *
 * Determinism contract: start() resets the VM so frame 0 of the trace is the
 * VM's reset state (same as a headless replay's first step); each frame
 * stores the final merged signals, so replay bypasses the signal tracker
 * (whose live smoothing state predates the recording and cannot be rebuilt).
 * A preset switch mid-recording finalizes the capture at the last frame of
 * the recorded preset instead of producing an unreplayable mixed trace.
 */

import {
  captureFrame,
  type FrameInputs,
  type TraceFile,
} from '../trace-capture';
import type { MilkdropFrameState, MilkdropRuntimeSignals } from '../types';

/** ~10 minutes at 60fps; a forgotten recording must not grow unbounded. */
const MAX_LIVE_TRACE_FRAMES = 36_000;

export type MilkdropTraceRecorderState = {
  recording: boolean;
  presetId: string | null;
  frameCount: number;
  /** True when recording stopped on its own (preset switch or frame cap). */
  autoStopped: boolean;
};

export type MilkdropTraceRecorder = {
  start: (options?: { maxFrames?: number }) => MilkdropTraceRecorderState;
  /** Cheap per-frame gate: the frame loop checks this before building the
   * recordFrame args (frame/signal snapshots), so agent-mode sessions pay
   * nothing extra on the ~all frames where nothing is being recorded. */
  isRecording: () => boolean;
  /** Called by the frame loop with the raw (pre-interaction-response) frame
   * state; must run synchronously before anything mutates it. */
  recordFrame: (args: {
    time: number;
    deltaMs: number;
    frequencyData: Uint8Array;
    waveformData: Uint8Array;
    signals: Partial<MilkdropRuntimeSignals>;
    frameState: MilkdropFrameState;
    /** Effective detail scale the VM stepped with (quality x adaptive). */
    detailScale?: number;
  }) => void;
  stop: () => TraceFile | null;
  getState: () => MilkdropTraceRecorderState;
};

function snapshotSignalArrays(
  signals: Partial<MilkdropRuntimeSignals>,
): FrameInputs['arrays'] {
  let out: FrameInputs['arrays'];
  for (const key of Object.keys(signals)) {
    if (key === 'frequencyData' || key === 'waveformData') {
      continue; // stored as first-class FrameInputs fields
    }
    const value = (signals as Record<string, unknown>)[key];
    if (value instanceof Uint8Array) {
      out ??= {};
      out[key] = { type: 'u8', values: Array.from(value) };
    } else if (value instanceof Float32Array) {
      out ??= {};
      out[key] = { type: 'f32', values: Array.from(value) };
    }
  }
  return out;
}

function snapshotSignals(
  signals: Partial<MilkdropRuntimeSignals>,
): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  for (const key of Object.keys(signals)) {
    const value = (signals as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

export function createMilkdropTraceRecorder({
  vm,
  getBackend,
  getWebGpuFlags,
}: {
  vm: { reset: () => void };
  /** Backend the session renders on; recorded so replay configures the VM
   * identically (procedural wave/mesh routing). Defaults to 'webgl'. */
  getBackend?: () => 'webgl' | 'webgpu';
  getWebGpuFlags?: () => Record<string, boolean>;
}): MilkdropTraceRecorder {
  let recording = false;
  let autoStopped = false;
  let presetId: string | null = null;
  let maxFrames = MAX_LIVE_TRACE_FRAMES;
  let inputs: FrameInputs[] = [];
  let frames: TraceFile['frames'] = [];

  const getState = (): MilkdropTraceRecorderState => ({
    recording,
    presetId,
    frameCount: frames.length,
    autoStopped,
  });

  const finalize = (): TraceFile | null => {
    recording = false;
    if (!presetId || frames.length === 0) {
      return null;
    }
    return {
      version: 1,
      presetId,
      capturedAt: new Date().toISOString(),
      fps: 60,
      scenario: 'live',
      frameCount: frames.length,
      inputs,
      frames,
      source: 'live',
      backend: getBackend?.() ?? 'webgl',
      webgpuFlags: getWebGpuFlags ? { ...getWebGpuFlags() } : undefined,
    };
  };

  return {
    start(options) {
      maxFrames = Math.min(
        options?.maxFrames ?? MAX_LIVE_TRACE_FRAMES,
        MAX_LIVE_TRACE_FRAMES,
      );
      inputs = [];
      frames = [];
      presetId = null;
      autoStopped = false;
      // Frame 0 of the trace must start from a state a headless replay can
      // reconstruct; the reset costs one visual discontinuity.
      vm.reset();
      recording = true;
      return getState();
    },
    recordFrame({
      time,
      deltaMs,
      frequencyData,
      waveformData,
      signals,
      frameState,
      detailScale,
    }) {
      if (!recording) {
        return;
      }
      if (presetId === null) {
        presetId = frameState.presetId;
      } else if (frameState.presetId !== presetId) {
        // Preset switched under the recording; the frames so far are a
        // complete, replayable trace of the original preset — keep them.
        recording = false;
        autoStopped = true;
        return;
      }
      inputs.push({
        time,
        deltaMs,
        frequencyData: Array.from(frequencyData),
        waveformData: Array.from(waveformData),
        signals: snapshotSignals(signals),
        detailScale,
        arrays: snapshotSignalArrays(signals),
      });
      frames.push(captureFrame(frameState));
      if (frames.length >= maxFrames) {
        recording = false;
        autoStopped = true;
      }
    },
    stop: finalize,
    getState,
    isRecording: () => recording,
  };
}
