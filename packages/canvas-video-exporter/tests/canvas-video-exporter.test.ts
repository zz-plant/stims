import { describe, expect, it } from 'bun:test';
import {
  CanvasVideoExporter,
  type CanvasVideoExporterEnvironment,
  type CanvasVideoExportRuntime,
  EXPORT_PRESETS,
} from '../src/index.ts';
import { frameBus } from './frame-bus.ts';
import {
  type GreyCanvas,
  greyCanvas,
  greyCanvasFactory,
} from './grey-canvas.ts';

class FakeMediaRecorder {
  mimeType = 'video/webm;codecs=vp9';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;

  start() {}
  stop() {
    this.ondataavailable?.({
      data: new Blob(['recorded'], { type: this.mimeType }),
    } as BlobEvent);
    this.onstop?.();
  }
}

/** The canvas whose capture the recorder was handed. */
function recordedCanvas(stream: MediaStream): GreyCanvas {
  const [track] = stream.getVideoTracks() as unknown as Array<{
    canvas: GreyCanvas;
  }>;
  if (!track) throw new Error('the recorder was handed no video track');
  return track.canvas;
}

/** An environment that records through FakeMediaRecorder and notes the canvas. */
function fakeEnvironment(
  seen: { recorded: GreyCanvas | null },
  overrides: Partial<CanvasVideoExporterEnvironment> = {},
): CanvasVideoExporterEnvironment {
  return {
    mediaRecorderAvailable: true,
    isMimeTypeSupported: (mimeType) => mimeType.includes('vp9'),
    createCanvas: greyCanvasFactory().create,
    createMediaRecorder: (stream) => {
      seen.recorded = recordedCanvas(stream);
      return new FakeMediaRecorder() as unknown as MediaRecorder;
    },
    createMediaStream: () => {
      throw new Error('there is no audio to compose');
    },
    ...overrides,
  };
}

describe('CanvasVideoExporter', () => {
  it('defines the export presets with their dimensions', () => {
    // Dimensions and aspect ratio only. The `label` strings are human-facing
    // copy: asserting them here means rewording a menu entry reddens the
    // suite, while a wrong width, the thing that breaks an export, reads the
    // same either way.
    const expected = {
      'spotify-canvas': { width: 1080, height: 1920, aspectRatio: '9:16' },
      'tiktok-shorts': { width: 1080, height: 1920, aspectRatio: '9:16' },
      'youtube-shorts': { width: 1080, height: 1920, aspectRatio: '9:16' },
      'square-post': { width: 1080, height: 1080, aspectRatio: '1:1' },
      'hd-landscape': { width: 1920, height: 1080, aspectRatio: '16:9' },
      '4k-landscape': { width: 3840, height: 2160, aspectRatio: '16:9' },
      custom: { width: 1280, height: 720, aspectRatio: 'custom' },
    } as const;

    for (const [id, dims] of Object.entries(expected)) {
      expect(EXPORT_PRESETS[id as keyof typeof EXPORT_PRESETS]).toMatchObject(
        dims,
      );
    }
    expect(Object.keys(EXPORT_PRESETS).sort()).toEqual(
      Object.keys(expected).sort(),
    );
  });

  it('records a preset-sized copy without resizing or pausing the live canvas', async () => {
    const seen: { recorded: GreyCanvas | null } = { recorded: null };
    const bus = frameBus();
    const changes: boolean[] = [];
    const source = greyCanvas(200, { width: 800, height: 600 });
    const exporter = new CanvasVideoExporter(
      source,
      fakeEnvironment(seen),
      null,
      {
        subscribeToFrames: bus.subscribe,
        onRecordingChange: (active) => changes.push(active),
      },
    );

    expect(
      exporter.startRecording({ preset: 'spotify-canvas', fps: 30 }),
    ).toEqual({
      ok: true,
      mimeType: 'video/webm;codecs=vp9',
    });
    expect(source.width).toBe(800);
    expect(source.height).toBe(600);
    const recorded = seen.recorded as GreyCanvas;
    expect(recorded).not.toBe(source);
    expect([recorded.width, recorded.height]).toEqual([1080, 1920]);
    expect(recorded.captures).toEqual([30]);
    expect(changes).toEqual([true]);

    // Painted with the source's frames on each notification.
    bus.frame();
    expect(recorded.level).toBe(200);
    source.level = 90;
    bus.frame();
    expect(recorded.level).toBe(90);
    expect(exporter.getRecordingStatus()).toBe(true);

    const recording = await exporter.stopRecording();
    expect(recording?.type).toBe('video/webm;codecs=vp9');
    expect(recorded.captureStopped).toBe(true);
    expect(exporter.getRecordingStatus()).toBe(false);
    expect(changes).toEqual([true, false]);
    expect(bus.listeners).toBe(0);
  });

  it('records from the frames a createFrames hook provides', async () => {
    const seen: { recorded: GreyCanvas | null } = { recorded: null };
    const mine = greyCanvas(42, { width: 640, height: 360 });
    const sizes: Array<{ width: number; height: number } | undefined> = [];
    let disposed = 0;
    const exporter = new CanvasVideoExporter(
      greyCanvas(200),
      fakeEnvironment(seen),
      null,
      {
        createFrames: ({ size }) => {
          sizes.push(size);
          return {
            canvas: mine,
            dispose: () => {
              disposed += 1;
            },
          };
        },
      },
    );
    expect(exporter.startRecording({ preset: 'hd-landscape' }).ok).toBe(true);
    expect(sizes).toEqual([{ width: 1920, height: 1080 }]);
    expect(seen.recorded).toBe(mine);
    await exporter.stopRecording();
    expect(disposed).toBe(1);
  });

  it('reports unsupported recording without constructing a recorder', () => {
    const source = {
      captureStream() {},
    } as unknown as HTMLCanvasElement;
    const environment: CanvasVideoExporterEnvironment = {
      mediaRecorderAvailable: false,
      isMimeTypeSupported: () => false,
      createCanvas: () => {
        throw new Error('should not create a copy');
      },
      createMediaRecorder: () => {
        throw new Error('should not create a recorder');
      },
      createMediaStream: () => {
        throw new Error('should not create a stream');
      },
    };
    const exporter = new CanvasVideoExporter(source, environment);

    expect(exporter.getSupport()).toEqual({
      supported: false,
      mimeType: null,
      reason: 'Video recording is not supported by this browser.',
    });
    expect(exporter.startRecording()).toEqual({
      ok: false,
      reason: 'Video recording is not supported by this browser.',
    });
  });

  it('refuses a second recording while one runs', () => {
    const seen: { recorded: GreyCanvas | null } = { recorded: null };
    const exporter = new CanvasVideoExporter(
      greyCanvas(200),
      fakeEnvironment(seen),
      null,
      { subscribeToFrames: frameBus().subscribe },
    );
    expect(exporter.startRecording().ok).toBe(true);
    expect(exporter.startRecording()).toEqual({
      ok: false,
      reason: 'A recording is already in progress.',
    });
  });

  it('records 4K from a native renderer resize, capturing the source itself, and composes a cloned audio track', async () => {
    const stoppedTracks: string[] = [];
    const originalAudioTrack = {
      kind: 'audio',
      clone: () => ({
        kind: 'audio',
        stop: () => stoppedTracks.push('audio-clone'),
      }),
      stop: () => stoppedTracks.push('audio-original'),
    } as unknown as MediaStreamTrack;
    const audioStream = {
      getAudioTracks: () => [originalAudioTrack],
    } as unknown as MediaStream;
    const source = greyCanvas(200, { width: 800, height: 600 });
    const lifecycle: string[] = [];
    const runtime: CanvasVideoExportRuntime = {
      beginNativeCapture: ({ width, height }) => {
        lifecycle.push(`begin:${width}x${height}`);
        source.width = width;
        source.height = height;
        return {
          ok: true,
          restore: () => {
            lifecycle.push('restore');
            source.width = 800;
            source.height = 600;
          },
        };
      },
      getAudioStream: () => audioStream,
    };
    let recorderVideoTrackCount = 0;
    let recorderAudioTrackCount = 0;
    const seen: { recorded: GreyCanvas | null } = { recorded: null };
    const environment = fakeEnvironment(seen, {
      createMediaRecorder: (stream) => {
        recorderVideoTrackCount = stream.getVideoTracks().length;
        recorderAudioTrackCount = stream.getAudioTracks().length;
        seen.recorded = recordedCanvas(stream);
        return new FakeMediaRecorder() as unknown as MediaRecorder;
      },
      createMediaStream: (tracks) =>
        ({
          getTracks: () => tracks,
          getAudioTracks: () =>
            tracks.filter((track) => track.kind === 'audio'),
          getVideoTracks: () =>
            tracks.filter((track) => track.kind === 'video'),
        }) as unknown as MediaStream,
    });
    const exporter = new CanvasVideoExporter(source, environment, runtime);

    expect(
      exporter.startRecording({ preset: '4k-landscape', fps: 60 }),
    ).toEqual({ ok: true, mimeType: 'video/webm;codecs=vp9' });
    expect(source.width).toBe(3840);
    expect(source.height).toBe(2160);
    expect(recorderVideoTrackCount).toBe(1);
    expect(recorderAudioTrackCount).toBe(1);
    expect(lifecycle).toEqual(['begin:3840x2160']);
    // The renderer draws at 4K and that canvas is what is captured: no
    // upscale from the on-screen size.
    expect(seen.recorded).toBe(source);
    expect(source.captures).toEqual([60]);

    const recording = await exporter.stopRecording();
    expect(recording?.size).toBeGreaterThan(0);
    expect(source.width).toBe(800);
    expect(source.height).toBe(600);
    expect(lifecycle).toEqual(['begin:3840x2160', 'restore']);
    expect(source.captureStopped).toBe(true);
    expect(stoppedTracks).toEqual(['audio-clone']);
  });

  it('records a cropped copy of a 9:16 preset when native capture is declined', () => {
    const seen: { recorded: GreyCanvas | null } = { recorded: null };
    const runtime: CanvasVideoExportRuntime = {
      beginNativeCapture: () => {
        throw new Error('native capture was declined');
      },
      getAudioStream: () => null,
    };
    const source = greyCanvas(200, { width: 800, height: 600 });
    const exporter = new CanvasVideoExporter(
      source,
      fakeEnvironment(seen),
      runtime,
      { subscribeToFrames: frameBus().subscribe },
    );
    expect(
      exporter.startRecording({ preset: 'tiktok-shorts', native: false }).ok,
    ).toBe(true);
    const recorded = seen.recorded as GreyCanvas;
    expect(recorded).not.toBe(source);
    expect([recorded.width, recorded.height]).toEqual([1080, 1920]);
  });

  it('rejects 4K when the runtime cannot render it natively, and without a runtime', () => {
    const source = {
      width: 800,
      height: 600,
      captureStream() {},
    } as unknown as HTMLCanvasElement;
    const environment: CanvasVideoExporterEnvironment = {
      mediaRecorderAvailable: true,
      isMimeTypeSupported: () => true,
      createCanvas: () => {
        throw new Error('should not create a copy');
      },
      createMediaRecorder: () => {
        throw new Error('should not create a recorder');
      },
      createMediaStream: () => {
        throw new Error('should not create a stream');
      },
    };
    const runtime: CanvasVideoExportRuntime = {
      beginNativeCapture: () => ({
        ok: false,
        reason: 'The active WebGPU backend cannot allocate a 4K surface.',
      }),
      getAudioStream: () => null,
    };
    expect(
      new CanvasVideoExporter(source, environment, runtime).startRecording({
        preset: '4k-landscape',
      }),
    ).toEqual({
      ok: false,
      reason: 'The active WebGPU backend cannot allocate a 4K surface.',
    });
    expect(
      new CanvasVideoExporter(source, environment).startRecording({
        preset: '4k-landscape',
      }),
    ).toEqual({
      ok: false,
      reason:
        'Native 4K export is unavailable because the renderer is not ready.',
    });
  });

  it('restores the renderer and reports no recording when the recorder cannot start', () => {
    const seen: { recorded: GreyCanvas | null } = { recorded: null };
    const lifecycle: string[] = [];
    const changes: boolean[] = [];
    const runtime: CanvasVideoExportRuntime = {
      beginNativeCapture: () => ({
        ok: true,
        restore: () => lifecycle.push('restore'),
      }),
      getAudioStream: () => null,
    };
    const exporter = new CanvasVideoExporter(
      greyCanvas(200),
      fakeEnvironment(seen, {
        createMediaRecorder: () => {
          throw new Error('NotSupportedError: codec');
        },
      }),
      runtime,
      { onRecordingChange: (active) => changes.push(active) },
    );
    expect(exporter.startRecording({ preset: 'square-post' })).toEqual({
      ok: false,
      reason: 'NotSupportedError: codec',
    });
    expect(lifecycle).toEqual(['restore']);
    expect(changes).toEqual([]);
    expect(exporter.getRecordingStatus()).toBe(false);
  });
});
