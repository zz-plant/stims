import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CanvasVideoExporter,
  type CanvasVideoExporterEnvironment,
  EXPORT_PRESETS,
} from '../../src/js/utils/canvas-video-exporter.ts';

describe('Canvas Video Exporter Utility', () => {
  it('defines valid export presets with correct dimensions', () => {
    expect(EXPORT_PRESETS['spotify-canvas']).toEqual({
      width: 1080,
      height: 1920,
      label: 'Spotify Canvas (9:16 Vertical)',
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

  it('wires accessible HD and Spotify controls into the workspace', () => {
    const panelSource = readFileSync(
      join(
        import.meta.dir,
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
