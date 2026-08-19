/**
 * Live trace capture → headless replay round-trip. The recorder's contract
 * is that a trace captured from a running VM (with per-frame merged signals)
 * replays bit-for-bit through the lab:replay CPU path, because start()
 * resets the VM and replay feeds the recorded signals straight to vm.step,
 * bypassing the signal tracker.
 */
import { describe, expect, test } from 'bun:test';
import { runTrace } from '../../scripts/preset-lab-replay.ts';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import { DEFAULT_MILKDROP_PRESET_SOURCE } from '../../src/js/milkdrop/runtime/default-preset.ts';
import { createMilkdropTraceRecorder } from '../../src/js/milkdrop/runtime/trace-recorder.ts';
import { reviveInputArrays } from '../../src/js/milkdrop/trace-capture.ts';
import type { MilkdropRuntimeSignals } from '../../src/js/milkdrop/types.ts';
import { createMilkdropVM } from '../../src/js/milkdrop/vm.ts';

const PRESET_ID = 'trace-recorder-spec';

/** Deterministic fake analyser bytes, distinct per frame so wave geometry
 * actually varies across the recording. */
function syntheticBytes(frame: number): Uint8Array {
  const bytes = new Uint8Array(64);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = (frame * 37 + i * 11) % 256;
  }
  return bytes;
}

function syntheticSignals(
  frame: number,
  waveformData: Uint8Array,
  frequencyData: Uint8Array,
): Partial<MilkdropRuntimeSignals> {
  const time = frame / 60;
  return {
    time,
    deltaMs: 1000 / 60,
    frame,
    fps: 60,
    bass: 0.8 + 0.3 * Math.sin(time * 5),
    mid: 0.6,
    treb: 0.5 + 0.2 * Math.cos(time * 3),
    vol: 0.7,
    // The live frame loop's merged signals carry the analyser arrays; the
    // recorder must drop them from the JSON snapshot and replay must
    // reattach them from the recorded inputs.
    waveformData,
    frequencyData,
  };
}

function makeVm() {
  const compiled = compileMilkdropPresetSource(DEFAULT_MILKDROP_PRESET_SOURCE, {
    id: PRESET_ID,
  });
  return createMilkdropVM(compiled);
}

describe('milkdrop trace recorder', () => {
  test('captured live trace replays bit-for-bit through runTrace', () => {
    const vm = makeVm();
    const recorder = createMilkdropTraceRecorder({ vm });
    expect(recorder.start().recording).toBe(true);

    for (let frame = 0; frame < 12; frame += 1) {
      const frequencyData = syntheticBytes(frame);
      const waveformData = syntheticBytes(frame + 100);
      const signals = syntheticSignals(frame, waveformData, frequencyData);
      recorder.recordFrame({
        time: signals.time as number,
        deltaMs: signals.deltaMs as number,
        frequencyData,
        waveformData,
        signals,
        frameState: vm.step(signals as MilkdropRuntimeSignals),
      });
    }
    const trace = recorder.stop();
    expect(trace).not.toBeNull();
    expect(trace?.source).toBe('live');
    expect(trace?.presetId).toBe(PRESET_ID);
    expect(trace?.frames.length).toBe(12);
    expect(trace?.inputs?.[0]?.signals?.bass).toBeCloseTo(0.8, 5);

    const replayed = runTrace(
      DEFAULT_MILKDROP_PRESET_SOURCE,
      PRESET_ID,
      trace?.inputs ?? [],
    );
    for (const [index, frame] of (trace?.frames ?? []).entries()) {
      expect(replayed[index]?.digest).toBe(frame.digest);
    }
  });

  test('preset switch mid-recording finalizes the capture', () => {
    const vm = makeVm();
    const recorder = createMilkdropTraceRecorder({ vm });
    recorder.start();

    const bytes = syntheticBytes(0);
    const signals = syntheticSignals(0, bytes, bytes) as MilkdropRuntimeSignals;
    recorder.recordFrame({
      time: 0,
      deltaMs: 16,
      frequencyData: bytes,
      waveformData: bytes,
      signals,
      frameState: vm.step(signals),
    });

    // Minimal frame state under a different preset id (the compiler caches
    // by source text, so compiling the same source under a new id would
    // hand back the original id).
    const switchedFrameState = {
      presetId: 'another-preset',
      variables: {},
      mainWave: { positions: [] },
      customWaves: [],
      shapes: [],
    } as unknown as ReturnType<typeof vm.step>;
    recorder.recordFrame({
      time: 1 / 60,
      deltaMs: 16,
      frequencyData: bytes,
      waveformData: bytes,
      signals,
      frameState: switchedFrameState,
    });

    const state = recorder.getState();
    expect(state.recording).toBe(false);
    expect(state.autoStopped).toBe(true);
    expect(state.frameCount).toBe(1);
    expect(recorder.stop()?.presetId).toBe(PRESET_ID);
  });

  test('stereo and float-waveform signal arrays survive record -> stop -> revive byte-for-byte', () => {
    // The live frame loop's merged signals can carry stereo/float analyser
    // arrays (waveformDataL/R, waveformFloatData*) beyond the mono bytes
    // stored as first-class FrameInputs fields — runtime-signals.ts assigns
    // them onto the same signals object the VM steps with. Verified here at
    // the record/revive boundary directly (independent of which preset/wave
    // mode actually reads them), since that's the exact contract at risk:
    // any typed-array field, by name, must round-trip through the JSON
    // snapshot without being silently dropped like the plain-number fields.
    const vm = makeVm();
    const recorder = createMilkdropTraceRecorder({ vm });
    recorder.start();

    const mono = syntheticBytes(0);
    const waveformDataL = new Uint8Array([10, 20, 30, 255]);
    const waveformDataR = new Uint8Array([1, 2, 3, 4]);
    const waveformFloatData = new Float32Array([-1, -0.5, 0, 0.5, 1]);
    const signals = {
      ...syntheticSignals(0, mono, mono),
      waveformDataL,
      waveformDataR,
      waveformFloatData,
      // A non-array typed field the harness must still capture as a plain
      // number (not accidentally swept into the arrays bucket).
      percussiveRatio: 0.42,
    } as unknown as MilkdropRuntimeSignals;

    recorder.recordFrame({
      time: 0,
      deltaMs: 16,
      frequencyData: mono,
      waveformData: mono,
      signals,
      frameState: vm.step(signals),
    });
    const trace = recorder.stop();

    const recordedArrays = trace?.inputs?.[0]?.arrays;
    expect(recordedArrays?.waveformDataL).toEqual({
      type: 'u8',
      values: [10, 20, 30, 255],
    });
    expect(recordedArrays?.waveformDataR).toEqual({
      type: 'u8',
      values: [1, 2, 3, 4],
    });
    expect(recordedArrays?.waveformFloatData?.type).toBe('f32');
    expect(recordedArrays?.waveformFloatData?.values).toEqual([
      -1, -0.5, 0, 0.5, 1,
    ]);
    expect(trace?.inputs?.[0]?.signals?.percussiveRatio).toBe(0.42);
    // Plain numeric fields must not leak into the arrays bucket.
    expect(recordedArrays?.percussiveRatio).toBeUndefined();

    const revived = reviveInputArrays(recordedArrays ?? {});
    expect(revived.waveformDataL).toBeInstanceOf(Uint8Array);
    expect(Array.from(revived.waveformDataL as Uint8Array)).toEqual([
      10, 20, 30, 255,
    ]);
    expect(revived.waveformFloatData).toBeInstanceOf(Float32Array);
    expect(Array.from(revived.waveformFloatData as Float32Array)).toEqual([
      -1, -0.5, 0, 0.5, 1,
    ]);
  });

  test('stop without frames returns null', () => {
    const recorder = createMilkdropTraceRecorder({ vm: makeVm() });
    recorder.start();
    expect(recorder.stop()).toBeNull();
  });
});
