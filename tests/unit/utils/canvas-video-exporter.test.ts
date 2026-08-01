import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CanvasVideoExporter,
  type CanvasVideoExporterEnvironment,
  type CanvasVideoExportRuntime,
  EXPORT_PRESETS,
} from '../../../src/js/utils/media/canvas-video-exporter.ts';

describe('Canvas Video Exporter Utility', () => {
  it('defines valid export presets with correct dimensions', () => {
    expect(EXPORT_PRESETS['spotify-canvas']).toEqual({
      width: 1080,
      height: 1920,
      label: 'Spotify Canvas (9:16 Vertical)',
      aspectRatio: '9:16',
    });

    expect(EXPORT_PRESETS['tiktok-shorts']).toEqual({
      width: 1080,
      height: 1920,
      label: 'TikTok Video (9:16 60FPS)',
      aspectRatio: '9:16',
    });

    expect(EXPORT_PRESETS['youtube-shorts']).toEqual({
      width: 1080,
      height: 1920,
      label: 'YouTube Shorts (9:16 60FPS)',
      aspectRatio: '9:16',
    });

    expect(EXPORT_PRESETS['hd-landscape']).toEqual({
      width: 1920,
      height: 1080,
      label: 'Full HD Landscape (16:9)',
      aspectRatio: '16:9',
    });

    expect(EXPORT_PRESETS['4k-landscape']).toEqual({
      width: 3840,
      height: 2160,
      label: 'Ultra HD 4K (16:9)',
      aspectRatio: '16:9',
    });
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

  it('wires accessible HD and Spotify controls into the workspace', () => {
    const panelSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        '..',
        'src',
        'js',
        'frontend',
        'CapturePanel.tsx',
      ),
      'utf8',
    );
    const stageControlsSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        '..',
        'src',
        'js',
        'frontend',
        'StageControls.tsx',
      ),
      'utf8',
    );

    expect(panelSource).toContain("'4k-landscape'");
    expect(panelSource).toContain("'hd-landscape'");
    expect(panelSource).toContain("'spotify-canvas'");
    expect(panelSource).toContain('<fieldset');
    expect(panelSource).toContain('aria-live="polite"');
    expect(panelSource).toContain('Stop and save video');
    expect(stageControlsSource).toContain('Record visualizer video');
    expect(stageControlsSource).toContain(
      "ui.updatePanel(panel === 'capture' ? null : 'capture')",
    );
  });
});
