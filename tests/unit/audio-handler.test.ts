import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test';

let originalNavigatorDesc: any;
let initAudio: any;
let DEFAULT_MICROPHONE_CONSTRAINTS: any;
let EXACT_MICROPHONE_CONSTRAINTS: any;
let describeInputProcessingWarning: any;
let getFrequencyData: any;
let getFrequencyFrame: any;
let FrequencyAnalyser: any;
let stylizeFrequencyData: any;
let resolveAdaptiveFftSize: any;
let originalAudioContext: any;
let originalAudioWorkletNode: any;
let AudioCtor: any;
let PositionalAudioCtor: any;

class FakeAudioWorklet {
  addModule = mock().mockResolvedValue(undefined);
}

class FakeAudioContext {
  audioWorklet: any = new FakeAudioWorklet();
  destination = {};

  createMediaStreamSource = mock(() => ({
    connect: mock(),
    disconnect: mock(),
  }));
  createGain = mock(() => ({
    gain: { value: 1 },
    connect: mock(),
    disconnect: mock(),
  }));
  createAnalyser = mock(() => ({
    fftSize: 0,
    frequencyBinCount: 128,
    getByteFrequencyData: mock(),
    getByteTimeDomainData: mock((target: any) => target.fill(128)),
    connect: mock(),
    disconnect: mock(),
  }));
  close = mock();
}

class FakeAudioWorkletNode {
  static instances: any[] = [];

  port = { onmessage: null as any, postMessage: mock() };
  connect = mock();
  disconnect = mock();

  constructor() {
    FakeAudioWorkletNode.instances.push(this);
  }
}

beforeAll(async () => {
  originalAudioContext = (global as any).AudioContext;
  originalAudioWorkletNode = (global as any).AudioWorkletNode;
  (global as any).AudioContext = FakeAudioContext;
  (global as any).AudioWorkletNode = FakeAudioWorkletNode;

  const baseThree = await import('three');
  mock.module('three', () => {
    const AudioListener = mock(() => ({
      add: mock(),
      remove: mock(),
      context: new FakeAudioContext(),
    })) as any;
    AudioCtor = mock(() => ({
      setMediaStreamSource: mock(),
      setVolume: mock(),
      stop: mock(),
      disconnect: mock(),
    }));
    PositionalAudioCtor = mock(() => ({
      setMediaStreamSource: mock(),
      setVolume: mock(),
      stop: mock(),
      disconnect: mock(),
    }));
    const AudioAnalyser = mock((_audio, fftSize = 256) => {
      const data = new Uint8Array(fftSize / 2);
      return {
        analyser: { disconnect: mock() },
        frequencyBinCount: data.length,
        getFrequencyData: mock(() => data),
      };
    });

    class Camera {
      add = mock();
      remove = mock();
    }

    class Object3D {
      add = mock();
      remove = mock();
    }

    return {
      __esModule: true,
      ...baseThree,
      Audio: AudioCtor,
      AudioAnalyser,
      AudioListener,
      Camera,
      Object3D,
      PositionalAudio: PositionalAudioCtor,
    };
  });

  ({
    DEFAULT_MICROPHONE_CONSTRAINTS,
    EXACT_MICROPHONE_CONSTRAINTS,
    describeInputProcessingWarning,
    FrequencyAnalyser,
    initAudio,
    getFrequencyData,
    getFrequencyFrame,
    stylizeFrequencyData,
    resolveAdaptiveFftSize,
  } = await import('../../src/js/core/audio-handler.ts'));
});

describe('multichannel input', () => {
  test('asks for more than stereo without hard-constraining it', () => {
    const audio = DEFAULT_MICROPHONE_CONSTRAINTS.audio as MediaTrackConstraints;
    // `ideal`, never `exact`: the browser clamps to the device's real channel
    // count, and a hard constraint would fail outright on a laptop mic.
    expect(audio.channelCount).toEqual({ ideal: 8 });
    // The DSP that would wreck music analysis stays off.
    expect(audio.echoCancellation).toEqual({ ideal: false });
    expect(audio.autoGainControl).toEqual({ ideal: false });
  });
});

describe('granted input processing', () => {
  const streamWith = (settings: Record<string, unknown>) =>
    ({
      getAudioTracks: () => [{ getSettings: () => settings }],
    }) as unknown as MediaStream;

  test('says nothing when the browser honoured the request', () => {
    expect(
      describeInputProcessingWarning(
        streamWith({ autoGainControl: false, noiseSuppression: false }),
      ),
    ).toBeNull();
  });

  test('names the processors the browser left on', () => {
    const warning = describeInputProcessingWarning(
      streamWith({ autoGainControl: true, noiseSuppression: true }),
    );
    expect(warning).toContain('automatic gain control');
    expect(warning).toContain('noise suppression');
  });

  test('abstains when the platform reports no settings', () => {
    expect(describeInputProcessingWarning(null)).toBeNull();
    expect(
      describeInputProcessingWarning({
        getAudioTracks: () => [],
      } as unknown as MediaStream),
    ).toBeNull();
  });
});

describe('audio-handler utilities', () => {
  beforeEach(() => {
    FakeAudioWorkletNode.instances.length = 0;
    originalNavigatorDesc = Object.getOwnPropertyDescriptor(
      global,
      'navigator',
    );
    const nav = global.navigator;
    const track = { stop: mock() };
    const stream = { getTracks: mock(() => [track]) };

    Object.defineProperty(nav, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: {
        getUserMedia: mock().mockResolvedValue(stream),
      },
    });
    global.navigator = nav;
  });

  afterEach(() => {
    if (originalNavigatorDesc) {
      Object.defineProperty(global, 'navigator', originalNavigatorDesc);
      originalNavigatorDesc = undefined;
    } else {
      (global as any).navigator = undefined;
    }
  });

  afterAll(() => {
    if (originalAudioContext) {
      (global as any).AudioContext = originalAudioContext;
    } else {
      (global as any).AudioContext = undefined;
    }

    if (originalAudioWorkletNode) {
      (global as any).AudioWorkletNode = originalAudioWorkletNode;
    } else {
      (global as any).AudioWorkletNode = undefined;
    }

    mock.restore();
  });

  test('initAudio resolves with analyser and listener', async () => {
    const { analyser, listener, audio, stream } = await initAudio();
    expect(analyser).toBeDefined();
    expect(listener).toBeDefined();
    expect(audio).toBeDefined();
    expect(stream).toBeDefined();
  });

  test('initAudio hard-constrains the call DSP off', async () => {
    await initAudio();

    // `ideal: false` is a preference the browser may ignore, and a feed with
    // automatic gain control silently flattens the dynamics every
    // beat-reactive preset keys off. Ask with `exact` so a platform that
    // will not honour it says so instead of quietly compressing the mix.
    expect(global.navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith(
      EXACT_MICROPHONE_CONSTRAINTS,
    );
  });

  test('initAudio falls back to the soft request when exact is unsatisfiable', async () => {
    const track = { stop: mock() };
    const stream = { getTracks: mock(() => [track]) };
    const overconstrained = Object.assign(new Error('nope'), {
      name: 'OverconstrainedError',
    });
    const getUserMedia = mock()
      .mockRejectedValueOnce(overconstrained)
      .mockResolvedValue(stream);
    global.navigator.mediaDevices.getUserMedia = getUserMedia;

    await initAudio();

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[1][0]).toEqual(
      DEFAULT_MICROPHONE_CONSTRAINTS,
    );
  });

  test('initAudio does not re-prompt after a denial', async () => {
    const denied = Object.assign(new Error('denied'), {
      name: 'NotAllowedError',
    });
    const getUserMedia = mock().mockRejectedValue(denied);
    global.navigator.mediaDevices.getUserMedia = getUserMedia;

    await expect(initAudio()).rejects.toThrow();
    // Retrying softer cannot fix a denial, and a second prompt is worse
    // than reporting the first one.
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  test('initAudio disables monitoring by default to prevent microphone echo', async () => {
    await initAudio();

    const audioInstance = AudioCtor.mock.results[0]?.value;
    expect(audioInstance?.setVolume).toHaveBeenCalledWith(0);
  });

  test('initAudio can keep monitoring enabled when requested', async () => {
    await initAudio({ monitorInput: true });

    const audioInstance = AudioCtor.mock.results.at(-1)?.value;
    expect(audioInstance?.setVolume).not.toHaveBeenCalled();
  });

  test('initAudio can create positional audio', async () => {
    const { audio } = await initAudio({
      positional: true,
      object: { add: mock(), remove: mock() },
    });
    expect(audio).toBeDefined();
  });

  test('initAudio supports custom fftSize', async () => {
    await expect(initAudio({ fftSize: 512 })).resolves.toBeDefined();
  });

  test('initAudio loads the analyser worklet from the shared utils path', async () => {
    await initAudio();

    const listenerInstance = await import('three').then(
      ({ AudioListener }: any) => AudioListener.mock.results[0]?.value,
    );
    const addModuleArg =
      listenerInstance?.context?.audioWorklet?.addModule?.mock.calls[0]?.[0];

    expect(String(addModuleArg)).toContain('blob:');
  });

  test('FrequencyAnalyser uses AudioWorklet messages when the worklet path succeeds', async () => {
    const context = new FakeAudioContext();
    const analyser = await FrequencyAnalyser.create(
      context,
      /** @type {MediaStream} */ ({}),
      64,
    );
    const workletNode = FakeAudioWorkletNode.instances.at(-1);

    expect(workletNode).toBeDefined();

    const frequencyData = new Uint8Array(32);
    frequencyData[0] = 255;
    frequencyData[3] = 128;
    frequencyData[8] = 64;
    const waveform = new Uint8Array(64);
    for (let index = 0; index < waveform.length; index += 1) {
      waveform[index] = Math.round(
        (index / Math.max(1, waveform.length - 1)) * 255,
      );
    }

    workletNode.port.onmessage?.({
      data: {
        frequencyData,
        waveformData: waveform,
        rms: 0.42,
      },
    });

    expect(Array.from(analyser.getWaveformData())).toEqual(
      Array.from(waveform),
    );
    expect(analyser.getRmsLevel()).toBe(0.42);
    const bands = analyser.getMultiBandEnergy();
    expect(bands.bass).toBeGreaterThan(bands.mid);
    expect(bands.mid).toBeGreaterThan(bands.treble);
    expect(bands.bass).toBeGreaterThan(0.95);
  });

  test('initAudio rejects with unsupported error when media devices are missing', async () => {
    Object.defineProperty(global.navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    await expect(initAudio()).rejects.toEqual(
      expect.objectContaining({
        reason: 'unsupported',
        message: expect.stringContaining('does not support'),
      }),
    );
  });

  test('initAudio rejects with denied error when permission is blocked', async () => {
    const consoleErrorSpy = mock(() => {});
    const originalConsoleError = console.error;
    console.error = consoleErrorSpy;

    Object.defineProperty(global.navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: {
        getUserMedia: mock().mockRejectedValue(
          new DOMException('denied', 'NotAllowedError'),
        ),
      },
    });

    try {
      await expect(initAudio()).rejects.toEqual(
        expect.objectContaining({
          reason: 'denied',
          name: 'AudioAccessError',
        }),
      );
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    } finally {
      console.error = originalConsoleError;
    }
  });

  test('getFrequencyData returns a stylized copy without mutating analyser data', () => {
    const data = new Uint8Array([8, 12, 17, 15, 10, 7, 4, 2]);
    const analyser = {
      getFrequencyData: mock(() => data),
    };

    const result = getFrequencyData(analyser);

    expect(result).toHaveLength(data.length);
    expect(result).not.toBe(data);
    const second = getFrequencyData(analyser);
    expect(second).toBe(result);
    expect([...data]).toEqual([8, 12, 17, 15, 10, 7, 4, 2]);
    expect(Math.max(...result)).toBeLessThan(17);
    expect(analyser.getFrequencyData).toHaveBeenCalled();
  });

  test('getFrequencyFrame average matches the mean of the stylized data', () => {
    // The fused path accumulates the mean inside the stylize loops instead of
    // re-walking the array; the two must never drift apart.
    const cases = [
      new Uint8Array(64).map((_, i) => (i * 37 + 90) % 256), // loud / active
      new Uint8Array(64).map((_, i) => (i % 5 === 0 ? 12 : 3)), // quiet path
      new Uint8Array(64), // silent path
    ];
    for (const data of cases) {
      const analyser = { getFrequencyData: mock(() => data) };
      const { data: stylized, average } = getFrequencyFrame(analyser);
      const mean =
        stylized.length === 0
          ? 0
          : [...stylized].reduce((a: number, b: number) => a + b, 0) /
            stylized.length;
      expect(average).toBeCloseTo(mean, 10);
    }
  });

  test('FrequencyAnalyser exposes time-domain waveform data', async () => {
    const context = new FakeAudioContext();
    context.audioWorklet = undefined;
    const analyser = await FrequencyAnalyser.create(
      context,
      { getTracks: () => [] },
      256,
    );

    const waveform = analyser.getWaveformData();

    expect(waveform).toBeInstanceOf(Uint8Array);
    expect(waveform).toHaveLength(256);
    expect([...waveform.slice(0, 4)]).toEqual([128, 128, 128, 128]);
  });

  test('derives band energy from a captured spectrum without another analyser read', async () => {
    const context = new FakeAudioContext();
    context.audioWorklet = undefined;
    const analyser = await FrequencyAnalyser.create(
      context,
      { getTracks: () => [] },
      256,
    );
    const analyserNode = (context.createAnalyser as any).mock.results[0]?.value;

    const snapshot = analyser.getFrequencyData();
    analyser.getMultiBandEnergy(snapshot);

    expect(analyserNode.getByteFrequencyData).toHaveBeenCalledTimes(1);
  });

  test('stylizeFrequencyData leaves silent buffers untouched', () => {
    const data = new Uint8Array(16);

    const result = stylizeFrequencyData(data);

    expect(result).toBe(data);
    expect([...result]).toEqual(new Array(16).fill(0));
  });

  test('stylizeFrequencyData boosts bass-led spectra without clipping everything', () => {
    const data = new Uint8Array([18, 34, 52, 76, 68, 48, 28, 16, 10, 6]);

    stylizeFrequencyData(data);

    expect(data[0]).toBeGreaterThan(18);
    expect(data[2]).toBeGreaterThan(52);
    expect(data[8]).toBeGreaterThan(10);
    expect(Math.max(...data)).toBeLessThan(255);
  });

  test('stylizeFrequencyData damps very low activity instead of exaggerating it', () => {
    const data = new Uint8Array([6, 8, 11, 10, 7, 5, 4, 3]);

    stylizeFrequencyData(data);

    expect(Math.max(...data)).toBeLessThan(11);
    expect(data[0]).toBeLessThan(6);
    expect(data[2]).toBeLessThan(11);
  });

  test('resolveAdaptiveFftSize auto-scales FFT size based on sample rate', () => {
    expect(resolveAdaptiveFftSize(44100)).toBe(1024);
    expect(resolveAdaptiveFftSize(48000)).toBe(1024);
    expect(resolveAdaptiveFftSize(96000)).toBe(2048);
    expect(resolveAdaptiveFftSize(192000)).toBe(4096);
    expect(resolveAdaptiveFftSize(192000, 512)).toBe(512);
  });

  test('FrequencyAnalyser exposes stereo metrics and getters', async () => {
    const context = new FakeAudioContext();
    const analyser = await FrequencyAnalyser.create(
      context,
      { getTracks: () => [] },
      1024,
    );

    expect(analyser.getStereoWidth()).toBe(0);
    expect(analyser.getStereoBalance()).toBe(0);
    expect(analyser.getSpectralCrest()).toBe(1);
    expect(analyser.getZeroCrossingRate()).toBe(0);
    expect(analyser.getSpectralFlux()).toBe(0);
  });
});
