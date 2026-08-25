import { beforeEach, describe, expect, it, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openRecordPanel } from '../../../src/js/frontend/workspace-actions.ts';
import {
  CanvasVideoExporter,
  type CanvasVideoExporterEnvironment,
  type CanvasVideoExportRuntime,
  EXPORT_PRESETS,
} from '../../../src/js/utils/media/canvas-video-exporter.ts';

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

  it('records through a preset-sized mirror without resizing or pausing the live canvas', async () => {
    const drawCalls: unknown[][] = [];
    const stoppedTracks: string[] = [];
    const stream = {
      getTracks: () => [{ stop: () => stoppedTracks.push('video') }],
    } as unknown as MediaStream;
    const mirror = {
      width: 0,
      height: 0,
      captureStream: () => stream,
      getContext: () => ({
        drawImage: (...args: unknown[]) => drawCalls.push(args),
      }),
    } as unknown as HTMLCanvasElement;
    let frameCallback: FrameRequestCallback | null = null;

    class FakeMediaRecorder {
      mimeType = 'video/webm;codecs=vp9';
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      state = 'inactive';

      start() {
        this.state = 'recording';
      }

      stop() {
        this.ondataavailable?.({
          data: new Blob(['recorded'], { type: this.mimeType }),
        } as BlobEvent);
        this.state = 'inactive';
        this.onstop?.();
      }
    }

    const environment: CanvasVideoExporterEnvironment = {
      mediaRecorderAvailable: true,
      isMimeTypeSupported: (mimeType) => mimeType.includes('vp9'),
      createCanvas: () => mirror,
      createMediaRecorder: () =>
        new FakeMediaRecorder() as unknown as MediaRecorder,
      createMediaStream: () => stream,
      requestAnimationFrame: (callback) => {
        frameCallback = callback;
        return 17;
      },
      cancelAnimationFrame: () => {
        frameCallback = null;
      },
    };
    const source = {
      width: 800,
      height: 600,
      captureStream() {},
    } as unknown as HTMLCanvasElement;
    const exporter = new CanvasVideoExporter(source, environment);

    expect(
      exporter.startRecording({ preset: 'spotify-canvas', fps: 30 }),
    ).toEqual({
      ok: true,
      mimeType: 'video/webm;codecs=vp9',
    });
    expect(source.width).toBe(800);
    expect(source.height).toBe(600);
    expect(mirror.width).toBe(1080);
    expect(mirror.height).toBe(1920);
    expect(drawCalls).toHaveLength(1);

    (frameCallback as FrameRequestCallback | null)?.(16);
    expect(drawCalls).toHaveLength(2);
    expect(exporter.getRecordingStatus()).toBe(true);

    const recording = await exporter.stopRecording();
    expect(recording?.type).toBe('video/webm;codecs=vp9');
    expect(stoppedTracks).toEqual(['video']);
    expect(exporter.getRecordingStatus()).toBe(false);
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
      requestAnimationFrame: () => 0,
      cancelAnimationFrame: () => {},
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

  it('records 4K from a native renderer resize and composes a cloned audio track', async () => {
    const stoppedTracks: string[] = [];
    const originalAudioTrack = {
      kind: 'audio',
      clone: () => ({
        kind: 'audio',
        stop: () => stoppedTracks.push('audio-clone'),
      }),
      stop: () => stoppedTracks.push('audio-original'),
    } as unknown as MediaStreamTrack;
    const videoTrack = {
      kind: 'video',
      stop: () => stoppedTracks.push('video'),
    } as unknown as MediaStreamTrack;
    const videoStream = {
      getTracks: () => [videoTrack],
      getVideoTracks: () => [videoTrack],
    } as unknown as MediaStream;
    const audioStream = {
      getAudioTracks: () => [originalAudioTrack],
    } as unknown as MediaStream;
    let sourceWidth = 800;
    let sourceHeight = 600;
    const source = {
      get width() {
        return sourceWidth;
      },
      set width(value: number) {
        sourceWidth = value;
      },
      get height() {
        return sourceHeight;
      },
      set height(value: number) {
        sourceHeight = value;
      },
      captureStream: () => videoStream,
    } as unknown as HTMLCanvasElement;
    const lifecycle: string[] = [];
    const runtime: CanvasVideoExportRuntime = {
      beginNativeCapture: ({ width, height }) => {
        lifecycle.push(`begin:${width}x${height}`);
        sourceWidth = width;
        sourceHeight = height;
        return {
          ok: true,
          restore: () => {
            lifecycle.push('restore');
            sourceWidth = 800;
            sourceHeight = 600;
          },
        };
      },
      getAudioStream: () => audioStream,
    };
    let recorderVideoTrackCount = 0;
    let recorderAudioTrackCount = 0;

    class FakeMediaRecorder {
      mimeType = 'video/webm;codecs=vp9';
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;

      start() {}
      stop() {
        this.ondataavailable?.({
          data: new Blob(['native-4k'], { type: this.mimeType }),
        } as BlobEvent);
        this.onstop?.();
      }
    }

    const environment: CanvasVideoExporterEnvironment = {
      mediaRecorderAvailable: true,
      isMimeTypeSupported: (mimeType) => mimeType.includes('vp9'),
      createCanvas: () => {
        throw new Error('4K must not use a mirror canvas');
      },
      createMediaRecorder: (stream) => {
        recorderVideoTrackCount = stream.getVideoTracks().length;
        recorderAudioTrackCount = stream.getAudioTracks().length;
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
      requestAnimationFrame: () => {
        throw new Error('native 4K must not schedule mirror copies');
      },
      cancelAnimationFrame: () => {},
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

    const recording = await exporter.stopRecording();
    expect(recording?.size).toBeGreaterThan(0);
    expect(source.width).toBe(800);
    expect(source.height).toBe(600);
    expect(lifecycle).toEqual(['begin:3840x2160', 'restore']);
    expect(stoppedTracks).toEqual(['video', 'audio-clone']);
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
      requestAnimationFrame: () => 0,
      cancelAnimationFrame: () => {},
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
