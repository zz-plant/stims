import { beforeEach, describe, expect, it, test } from 'bun:test';
import { notifyFrameDrawn } from '../../../src/js/core/frame-drawn.ts';
import {
  resetStageLuminance,
  setStageLuminanceChannel,
} from '../../../src/js/core/services/stage-luminance.ts';
import {
  handleFlashKeyDown,
  resetStageUtilitiesForTests,
} from '../../../src/js/core/services/stage-utilities.ts';
import { openRecordPanel } from '../../../src/js/frontend/workspace-actions.ts';
import {
  CanvasVideoExporter,
  type CanvasVideoExporterEnvironment,
  type CanvasVideoExportRuntime,
  EXPORT_PRESETS,
} from '../../../src/js/utils/media/canvas-video-exporter.ts';
import {
  type GreyCanvas,
  greyCanvas,
  greyCanvasFactory,
} from '../../grey-canvas.ts';

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
  return track.canvas;
}

describe('Canvas Video Exporter Utility', () => {
  it('defines valid export presets with correct dimensions', () => {
    // Dimensions and aspect ratio only. The `label` strings are human-facing
    // copy: asserting them here means rewording a menu entry reddens the
    // suite, while a wrong width — the thing that actually breaks an export —
    // reads the same either way.
    const expected = {
      'spotify-canvas': { width: 1080, height: 1920, aspectRatio: '9:16' },
      'tiktok-shorts': { width: 1080, height: 1920, aspectRatio: '9:16' },
      'youtube-shorts': { width: 1080, height: 1920, aspectRatio: '9:16' },
      'square-post': { width: 1080, height: 1080, aspectRatio: '1:1' },
      'hd-landscape': { width: 1920, height: 1080, aspectRatio: '16:9' },
      '4k-landscape': { width: 3840, height: 2160, aspectRatio: '16:9' },
      // `custom` was missing from the old per-key assertions entirely — the
      // key-set check below is what surfaced it.
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
    const factory = greyCanvasFactory();
    const seen: { recorded: GreyCanvas | null } = { recorded: null };
    const environment: CanvasVideoExporterEnvironment = {
      mediaRecorderAvailable: true,
      isMimeTypeSupported: (mimeType) => mimeType.includes('vp9'),
      createCanvas: factory.create,
      createMediaRecorder: (stream) => {
        seen.recorded = recordedCanvas(stream);
        return new FakeMediaRecorder() as unknown as MediaRecorder;
      },
      createMediaStream: () => {
        throw new Error('there is no audio to compose');
      },
    };
    const source = greyCanvas(200, { width: 800, height: 600 });
    const exporter = new CanvasVideoExporter(source, environment);

    expect(
      exporter.startRecording({ preset: 'spotify-canvas', fps: 30 }),
    ).toEqual({
      ok: true,
      mimeType: 'video/webm;codecs=vp9',
    });
    expect(source.width).toBe(800);
    expect(source.height).toBe(600);
    const recorded = seen.recorded as GreyCanvas;
    expect([recorded.width, recorded.height]).toEqual([1080, 1920]);
    expect(recorded.captures).toEqual([30]);

    // Painted with the stage's own frames, the one moment it can be read.
    notifyFrameDrawn(0);
    expect(recorded.level).toBe(200);
    source.level = 90;
    notifyFrameDrawn(16);
    expect(recorded.level).toBe(90);
    expect(exporter.getRecordingStatus()).toBe(true);

    const recording = await exporter.stopRecording();
    expect(recording?.type).toBe('video/webm;codecs=vp9');
    expect(recorded.captureStopped).toBe(true);
    expect(exporter.getRecordingStatus()).toBe(false);
    source.level = 10;
    notifyFrameDrawn(32);
    expect(recorded.level).not.toBe(10);
  });

  it('carries the governor dimming and the stage cuts, but not the brightness ceiling', async () => {
    const stage = document.createElement('div');
    const seen: { recorded: GreyCanvas | null } = { recorded: null };
    const environment: CanvasVideoExporterEnvironment = {
      mediaRecorderAvailable: true,
      isMimeTypeSupported: () => true,
      createCanvas: greyCanvasFactory().create,
      createMediaRecorder: (stream) => {
        seen.recorded = recordedCanvas(stream);
        return new FakeMediaRecorder() as unknown as MediaRecorder;
      },
      createMediaStream: () => {
        throw new Error('there is no audio to compose');
      },
    };
    const exporter = new CanvasVideoExporter(
      greyCanvas(200),
      environment,
      null,
      () => stage,
    );
    try {
      exporter.startRecording({ preset: 'hd-landscape' });
      const recorded = seen.recorded as GreyCanvas;

      // The visitor's comfort setting, not something to bake into a file.
      setStageLuminanceChannel(stage, 'ceiling', 0.5);
      notifyFrameDrawn(0);
      expect(recorded.level).toBe(200);

      // Reduce flashing's dimming: a strobe shared onward reaches viewers
      // who never set the preference.
      setStageLuminanceChannel(stage, 'governor', 0.5);
      notifyFrameDrawn(16);
      expect(recorded.level).toBeCloseTo(100);

      setStageLuminanceChannel(stage, 'presentation', 0);
      notifyFrameDrawn(32);
      expect(recorded.level).toBe(0);

      setStageLuminanceChannel(stage, 'presentation', 1);
      handleFlashKeyDown(false);
      notifyFrameDrawn(48);
      expect(recorded.level).toBe(255);
    } finally {
      await exporter.stopRecording();
      resetStageLuminance(stage);
      resetStageUtilitiesForTests();
    }
  });

  it('reports unsupported recording without constructing a recorder', () => {
    const source = {
      captureStream() {},
    } as unknown as HTMLCanvasElement;
    const environment: CanvasVideoExporterEnvironment = {
      mediaRecorderAvailable: false,
      isMimeTypeSupported: () => false,
      createCanvas: () => {
        throw new Error('should not create a mirror');
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

  it('records 4K from a native renderer resize, copied at that size, and composes a cloned audio track', async () => {
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

    const environment: CanvasVideoExporterEnvironment = {
      mediaRecorderAvailable: true,
      isMimeTypeSupported: (mimeType) => mimeType.includes('vp9'),
      createCanvas: greyCanvasFactory().create,
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
    };
    const exporter = new CanvasVideoExporter(source, environment, runtime);

    expect(
      exporter.startRecording({ preset: '4k-landscape', fps: 60 }),
    ).toEqual({ ok: true, mimeType: 'video/webm;codecs=vp9' });
    expect(source.width).toBe(3840);
    expect(source.height).toBe(2160);
    expect(recorderVideoTrackCount).toBe(1);
    expect(recorderAudioTrackCount).toBe(1);
    expect(lifecycle).toEqual(['begin:3840x2160']);
    // The renderer draws at 4K and the copy follows it: dimming reaches the
    // file without an upscale from the on-screen size.
    source.level = 200;
    notifyFrameDrawn(0);
    const recorded = seen.recorded as GreyCanvas;
    expect([recorded.width, recorded.height]).toEqual([3840, 2160]);
    expect(recorded.level).toBe(200);

    const recording = await exporter.stopRecording();
    expect(recording?.size).toBeGreaterThan(0);
    expect(source.width).toBe(800);
    expect(source.height).toBe(600);
    expect(lifecycle).toEqual(['begin:3840x2160', 'restore']);
    expect(recorded.captureStopped).toBe(true);
    expect(stoppedTracks).toEqual(['audio-clone']);
  });

  it('rejects 4K honestly when the active runtime cannot render it natively', () => {
    const source = {
      width: 800,
      height: 600,
      captureStream() {},
    } as unknown as HTMLCanvasElement;
    const environment: CanvasVideoExporterEnvironment = {
      mediaRecorderAvailable: true,
      isMimeTypeSupported: () => true,
      createCanvas: () => {
        throw new Error('should not create a mirror');
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
    const exporter = new CanvasVideoExporter(source, environment, runtime);

    expect(exporter.startRecording({ preset: '4k-landscape' })).toEqual({
      ok: false,
      reason: 'The active WebGPU backend cannot allocate a 4K surface.',
    });
  });

  /**
   * These replace two assertions that grepped StageControls.tsx for the
   * literal toggle body. That body moved into workspace-actions.ts when the
   * dock and the command palette were unified onto one implementation, and
   * the greps silently went stale — they kept passing only because the file
   * they scanned had fallen out of the changed-file test scope. Testing the
   * exported function directly cannot rot the same way.
   */
  describe('openRecordPanel', () => {
    function surfaceOn(panel: string | null) {
      const calls: Array<string | null> = [];
      return {
        surface: {
          updatePanel: (next: string | null) => calls.push(next),
          routePanel: () => panel,
        } as unknown as Parameters<typeof openRecordPanel>[0],
        calls,
      };
    }

    beforeEach(() => {
      localStorage.removeItem('stims:capture-format');
      sessionStorage.removeItem('stims:capture-autostart');
    });

    test('closes the panel when it is already open', () => {
      const { surface, calls } = surfaceOn('capture');
      openRecordPanel(surface);
      expect(calls).toEqual([null]);
      expect(sessionStorage.getItem('stims:capture-autostart')).toBeNull();
    });

    test('first-ever use opens the form without autostarting', () => {
      const { surface, calls } = surfaceOn(null);
      openRecordPanel(surface);
      expect(calls).toEqual(['capture']);
      expect(sessionStorage.getItem('stims:capture-autostart')).toBeNull();
    });

    test('repeat use arms autostart from the remembered format', () => {
      localStorage.setItem('stims:capture-format', 'hd-landscape');
      const { surface, calls } = surfaceOn(null);
      openRecordPanel(surface);
      expect(calls).toEqual(['capture']);
      expect(sessionStorage.getItem('stims:capture-autostart')).toBe('1');
    });
  });
});
