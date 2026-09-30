/**
 * Lab audio-file input: decodes a WAV and runs it through the live audio stack offline, one video frame at a time.
 *
 * The synthetic lab scenarios are fine for reactivity checks, but anything
 * trained or measured on real music needs the bytes and signals the live
 * visualizer would actually have produced for that music. So this module
 * does not reimplement the analysis. It drives the real code:
 *
 *   - the AudioWorklet processor class (frequency-analyser-processor.ts),
 *     fed the file in 128-sample render quanta with `currentTime` advanced,
 *     so its FFT, beat detection and HPSS state evolve exactly as in Chrome;
 *   - the real FrequencyAnalyser (audio-handler.ts), built by its own
 *     `create()` against a stand-in AudioContext, so the fftSize and message
 *     cadence are whatever the live code picks, and the worklet messages
 *     reach its real port handler (waveform AGC, energy caches and all);
 *   - getContextFrequencyData and the milkdrop signal tracker, exactly as
 *     the frame loop calls them.
 *
 * Each frame's merged signals are snapshotted like a live trace
 * (snapshotFrameInputs), so lab:replay replays them without re-running any
 * of the above.
 *
 * Known differences from a browser session, all small: frames step at an
 * exact 1/fps (the live loop smooths a jittery rAF delta toward that);
 * the synthetic "silence" fill uses elapsed time rather than page time for
 * its phase; and viewport signals (aspect, pixelsx/y) are left unset.
 */

import { plugin } from 'bun';
import type { FrequencyAnalyser as FrequencyAnalyserType } from '../src/js/core/audio-handler.ts';
import {
  type FrameInputs,
  snapshotFrameInputs,
} from '../src/js/milkdrop/trace-capture.ts';

/** The fftSize the milkdrop engine session requests (milkdrop-engine-session.ts). */
const MILKDROP_FFT_SIZE = 1024;
/** AudioWorklet render quantum. */
const RENDER_QUANTUM = 128;
/**
 * The worklet's `currentTime` when the file starts. A live AudioContext's
 * clock is already running by the time music plays, and the worklet's beat
 * detector measures its 150 ms refractory period from a last-beat time of 0,
 * so a clock starting at 0 would suppress beats a live session reports.
 */
const CONTEXT_CLOCK_AT_START = 1;

export type DecodedAudio = {
  sampleRate: number;
  /** One Float32Array per channel, samples in [-1, 1]. */
  channels: Float32Array[];
};

/**
 * Decodes a RIFF/WAVE file: PCM 8/16/24/32-bit integer, 32/64-bit float,
 * and WAVE_FORMAT_EXTENSIBLE wrappers of either. Anything else throws with
 * the format code, so a caller knows to convert (e.g. `ffmpeg -i in.mp3
 * out.wav`) rather than getting silence.
 */
export function decodeWav(bytes: Uint8Array): DecodedAudio {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 12 || text(0) !== 'RIFF' || text(8) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file.');
  }
  let format: {
    code: number;
    channels: number;
    sampleRate: number;
    bits: number;
    blockAlign: number;
  } | null = null;
  let data: { offset: number; length: number } | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = text(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      let code = view.getUint16(body, true);
      if (code === 0xfffe && size >= 26) {
        // WAVE_FORMAT_EXTENSIBLE: the real format is the subformat GUID's
        // first two bytes.
        code = view.getUint16(body + 24, true);
      }
      format = {
        code,
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        blockAlign: view.getUint16(body + 12, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      data = { offset: body, length: Math.min(size, bytes.length - body) };
    }
    // Chunks are word-aligned.
    offset = body + size + (size % 2);
  }
  if (!format || !data) {
    throw new Error('WAV file is missing its fmt or data chunk.');
  }
  const { code, channels, sampleRate, bits, blockAlign } = format;
  const bytesPerSample = bits / 8;
  const isInt = code === 1 && [8, 16, 24, 32].includes(bits);
  const isFloat = code === 3 && (bits === 32 || bits === 64);
  if (!isInt && !isFloat) {
    throw new Error(
      `Unsupported WAV encoding (format ${code}, ${bits}-bit); convert to PCM or float WAV first.`,
    );
  }
  if (channels < 1 || blockAlign < channels * bytesPerSample) {
    throw new Error('WAV fmt chunk is inconsistent.');
  }
  const frames = Math.floor(data.length / blockAlign);
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const at = data.offset + frame * blockAlign + channel * bytesPerSample;
      let value: number;
      if (isFloat) {
        value =
          bits === 32 ? view.getFloat32(at, true) : view.getFloat64(at, true);
      } else if (bits === 8) {
        value = (view.getUint8(at) - 128) / 128;
      } else if (bits === 16) {
        value = view.getInt16(at, true) / 32768;
      } else if (bits === 24) {
        const raw =
          view.getUint8(at) |
          (view.getUint8(at + 1) << 8) |
          (view.getInt8(at + 2) << 16);
        value = raw / 8388608;
      } else {
        value = view.getInt32(at, true) / 2147483648;
      }
      (out[channel] as Float32Array)[frame] = value;
    }
  }
  return { sampleRate, channels: out };
}

type WorkletProcessor = {
  port: { postMessage: (message: unknown) => void; onmessage: unknown };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

type LiveAudioStack = {
  FrequencyAnalyser: typeof FrequencyAnalyserType;
  Processor: new (options?: {
    processorOptions?: Record<string, unknown>;
  }) => WorkletProcessor;
  getContextFrequencyData: typeof import('../src/js/core/animation-loop.ts').getContextFrequencyData;
  createMilkdropSignalTracker: typeof import('../src/js/milkdrop/runtime-signals.ts').createMilkdropSignalTracker;
};

let liveAudioStack: Promise<LiveAudioStack> | null = null;

/**
 * Loads the browser audio modules into this process. audio-handler.ts
 * imports the worklet through Vite's `?worklet` suffix (a bundled source
 * string for addModule); nothing here needs that string, so a Bun plugin
 * resolves it to an empty one. The worklet module also needs its global
 * scope's AudioWorkletProcessor/registerProcessor at import time.
 */
function loadLiveAudioStack(): Promise<LiveAudioStack> {
  liveAudioStack ??= (async () => {
    plugin({
      name: 'stims-lab-worklet-suffix',
      setup(build) {
        build.onResolve({ filter: /\?worklet$/ }, (args) => ({
          path: args.path,
          namespace: 'stims-lab-worklet-suffix',
        }));
        build.onLoad(
          { filter: /.*/, namespace: 'stims-lab-worklet-suffix' },
          () => ({ contents: 'export default "";', loader: 'js' }),
        );
      },
    });
    const scope = globalThis as unknown as Record<string, unknown>;
    scope.AudioWorkletProcessor ??= class {
      port = { postMessage: (_message: unknown) => {}, onmessage: null };
    };
    scope.registerProcessor ??= () => {};
    const [processorModule, audioHandler, animationLoop, runtimeSignals] =
      await Promise.all([
        import('../src/js/utils/audio/frequency-analyser-processor.ts'),
        import('../src/js/core/audio-handler.ts'),
        import('../src/js/core/animation-loop.ts'),
        import('../src/js/milkdrop/runtime-signals.ts'),
      ]);
    return {
      FrequencyAnalyser: audioHandler.FrequencyAnalyser,
      Processor:
        processorModule.FrequencyAnalyserProcessor as unknown as LiveAudioStack['Processor'],
      getContextFrequencyData: animationLoop.getContextFrequencyData,
      createMilkdropSignalTracker: runtimeSignals.createMilkdropSignalTracker,
    };
  })();
  return liveAudioStack;
}

/**
 * Builds a real FrequencyAnalyser around a stand-in AudioContext and returns
 * it with the port its worklet messages arrive on and the processorOptions
 * the live code chose for the worklet.
 */
async function createOfflineAnalyser(
  stack: LiveAudioStack,
  sampleRate: number,
  channelCount: number,
  fftSize: number,
) {
  const noop = () => {};
  const node = () => ({ connect: noop, disconnect: noop });
  let processorOptions: Record<string, unknown> | null = null;
  const port: { onmessage: ((event: { data: unknown }) => void) | null } = {
    onmessage: null,
  };
  const context = {
    state: 'running',
    sampleRate,
    destination: {},
    audioWorklet: { addModule: async () => {} },
    createMediaStreamSource: node,
    createGain: () => ({ ...node(), gain: { value: 1 } }),
    resume: async () => {},
  };
  const stream = {
    getAudioTracks: () => [{ getSettings: () => ({ channelCount }) }],
  };
  const scope = globalThis as unknown as Record<string, unknown>;
  const previousNode = scope.AudioWorkletNode;
  scope.AudioWorkletNode = function OfflineWorkletNode(
    _context: unknown,
    _name: string,
    options: { processorOptions: Record<string, unknown> },
  ) {
    processorOptions = { ...options.processorOptions };
    return { ...node(), port };
  };
  try {
    const analyser = await stack.FrequencyAnalyser.create(
      context as unknown as AudioContext,
      stream as unknown as MediaStream,
      fftSize,
    );
    if (!processorOptions || !port.onmessage) {
      throw new Error('FrequencyAnalyser did not take the worklet path.');
    }
    return {
      analyser,
      port,
      processorOptions: processorOptions as Record<string, unknown>,
    };
  } finally {
    scope.AudioWorkletNode = previousNode;
  }
}

export type AudioFileInputOptions = {
  fps?: number;
  /** Frames to produce; defaults to the rest of the file after startSeconds. */
  frames?: number;
  startSeconds?: number;
  /** Requested analyser fftSize; defaults to what the milkdrop engine asks for. */
  fftSize?: number;
  /**
   * Explicit frame instants instead of a fixed 1/fps grid: `time` is the
   * audio position in seconds (relative to startSeconds) and `deltaMs` the
   * frame delta the tracker sees. lab:audio-fidelity passes the instants a
   * real browser rendered at, so both sides are evaluated at the same audio
   * positions. Overrides fps and frames.
   */
  timeline?: ReadonlyArray<{ time: number; deltaMs: number }>;
  /**
   * Silence fed to the worklet before the file. A browser's worklet starts
   * analysing when its node starts, not when the music does, so its
   * 1024-sample blocks land at an arbitrary offset into the file; a lead-in
   * reproduces a given offset. lab:audio-fidelity measures it. Default 0.
   */
  leadInSamples?: number;
  /**
   * How far the analysis trails each frame's audio position, in samples: a
   * browser hears the file through a MediaStream and delivers worklet
   * messages late, so a frame at position t sees audio up to t - delay.
   * lab:audio-fidelity measures it. Default 0.
   */
  analysisDelaySamples?: number;
};

/**
 * Per-frame replay inputs for `audio`, as the live visualizer would have
 * produced them. Every frame carries `signals`, so replay feeds the VM
 * directly (the same path live traces take).
 */
export async function buildAudioFileInputs(
  audio: DecodedAudio,
  options: AudioFileInputOptions = {},
): Promise<FrameInputs[]> {
  const fps = options.fps ?? 60;
  const { sampleRate, channels } = audio;
  const left = channels[0];
  if (!left || sampleRate <= 0) {
    throw new Error('Audio has no samples.');
  }
  const right = channels[1];
  const startSample = Math.max(
    0,
    Math.round((options.startSeconds ?? 0) * sampleRate),
  );
  const available = Math.max(0, left.length - startSample);
  const { timeline } = options;
  const frameCount =
    timeline?.length ??
    options.frames ??
    Math.floor((available / sampleRate) * fps);

  const stack = await loadLiveAudioStack();
  const { analyser, port, processorOptions } = await createOfflineAnalyser(
    stack,
    sampleRate,
    right ? 2 : 1,
    options.fftSize ?? MILKDROP_FFT_SIZE,
  );
  const processor = new stack.Processor({ processorOptions });
  // Offline nothing is transferred or recycled, so every message owns fresh
  // buffers and can be delivered after later quanta have run.
  const pending: unknown[] = [];
  processor.port = {
    postMessage: (message) => pending.push(message),
    onmessage: null,
  };
  const tracker = stack.createMilkdropSignalTracker();
  const leadIn = Math.max(0, Math.round(options.leadInSamples ?? 0));
  const delay = Math.round(options.analysisDelaySamples ?? 0);
  const scope = globalThis as unknown as Record<string, unknown>;
  const quantumLeft = new Float32Array(RENDER_QUANTUM);
  const quantumRight = new Float32Array(RENDER_QUANTUM);
  const output = [[new Float32Array(RENDER_QUANTUM)]];
  let processed = 0;

  const inputs: FrameInputs[] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = timeline ? (timeline[frame]?.time ?? 0) : frame / fps;
    const deltaMs = timeline ? (timeline[frame]?.deltaMs ?? 0) : 1000 / fps;
    // Run the worklet up to this frame's instant, then hand its messages to
    // the analyser the way the message port would have between two rAFs.
    const target = Math.round(time * sampleRate) - delay + leadIn;
    while (processed < target) {
      // `processed` counts worklet samples, lead-in included.
      const from = startSample + processed - leadIn;
      for (let index = 0; index < RENDER_QUANTUM; index += 1) {
        const at = from + index;
        quantumLeft[index] = at >= startSample ? (left[at] ?? 0) : 0;
        quantumRight[index] = at >= startSample ? (right?.[at] ?? 0) : 0;
      }
      scope.currentTime = CONTEXT_CLOCK_AT_START + processed / sampleRate;
      processor.process(
        right ? [[quantumLeft, quantumRight]] : [[quantumLeft]],
        output,
      );
      processed += RENDER_QUANTUM;
    }
    for (const data of pending.splice(0)) {
      port.onmessage?.({ data });
    }

    const frequencyData = stack.getContextFrequencyData({
      toy: null,
      analyser,
      time,
      realTimeMs: time * 1000,
    } as unknown as Parameters<LiveAudioStack['getContextFrequencyData']>[0]);
    const waveformData = analyser.getWaveformData();
    const signals = tracker.update({
      time,
      deltaMs,
      analyser,
      frequencyData,
      waveformData,
    });
    inputs.push(
      snapshotFrameInputs({
        time,
        deltaMs,
        frequencyData,
        waveformData,
        signals,
      }),
    );
  }
  analyser.disconnect();
  return inputs;
}
