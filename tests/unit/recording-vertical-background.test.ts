import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { isHiddenTabSuspendingFrames } from '../../src/js/core/hidden-tab-policy.ts';
import { resetLivePerformanceModeForTests } from '../../src/js/core/live-performance-mode.ts';
import { getPowerSavingFrameCapHz } from '../../src/js/core/power-state.ts';
import { createBackgroundFrameTimer } from '../../src/js/core/services/background-frame-timer.ts';
import {
  isRecordingActive,
  resetRecordingActiveForTests,
  setRecordingActive,
} from '../../src/js/core/services/recording-state.ts';
import {
  CanvasVideoExporter,
  type CanvasVideoExporterEnvironment,
  type CanvasVideoExportRuntime,
  EXPORT_PRESETS,
} from '../../src/js/utils/media/canvas-video-exporter.ts';

describe('Recording Background & Vertical/Square Export', () => {
  beforeEach(() => {
    resetRecordingActiveForTests();
    resetLivePerformanceModeForTests();
    if (typeof document !== 'undefined') {
      delete document.documentElement?.dataset.agentMode;
    }
  });

  afterEach(() => {
    resetRecordingActiveForTests();
    resetLivePerformanceModeForTests();
  });

  describe('hidden-tab-policy exemption', () => {
    it('exempts active recording sessions from hidden-tab suspension', () => {
      // In bun test jsdom-like document:
      const doc = globalThis.document;
      if (!doc) return;

      Object.defineProperty(doc, 'hidden', {
        value: true,
        configurable: true,
      });

      expect(isRecordingActive()).toBe(false);
      expect(isHiddenTabSuspendingFrames()).toBe(true);

      setRecordingActive(true);
      expect(isRecordingActive()).toBe(true);
      expect(isHiddenTabSuspendingFrames()).toBe(false);

      setRecordingActive(false);
      expect(isHiddenTabSuspendingFrames()).toBe(true);

      Object.defineProperty(doc, 'hidden', {
        value: false,
        configurable: true,
      });
      expect(isHiddenTabSuspendingFrames()).toBe(false);
    });
  });

  describe('power-saving frame cap exemption', () => {
    it('lifts frame ceiling when recording is active', () => {
      expect(isRecordingActive()).toBe(false);
      setRecordingActive(true);
      expect(getPowerSavingFrameCapHz()).toBeNull();
    });
  });

  describe('native capture for vertical (9:16) and square (1:1) presets', () => {
    it('defines 1080x1080 square-post preset', () => {
      expect(EXPORT_PRESETS['square-post']).toEqual({
        width: 1080,
        height: 1080,
        label: 'Square post (1:1, 1080×1080)',
        aspectRatio: '1:1',
      });
    });

    it('renders native 9:16 directly through runtime beginNativeCapture', async () => {
      const captures: Array<{ width: number; height: number }> = [];
      let restored = false;

      const runtime: CanvasVideoExportRuntime = {
        beginNativeCapture: ({ width, height }) => {
          captures.push({ width, height });
          return {
            ok: true,
            restore: () => {
              restored = true;
            },
          };
        },
        getAudioStream: () => null,
      };

      const sourceCanvas = {
        width: 800,
        height: 600,
        captureStream: () => ({
          getTracks: () => [],
          getVideoTracks: () => [],
          getAudioTracks: () => [],
        }),
      } as unknown as HTMLCanvasElement;

      class FakeMediaRecorder {
        mimeType = 'video/webm';
        ondataavailable: ((e: BlobEvent) => void) | null = null;
        onstop: (() => void) | null = null;
        start() {}
        stop() {
          this.onstop?.();
        }
      }

      const env: CanvasVideoExporterEnvironment = {
        mediaRecorderAvailable: true,
        isMimeTypeSupported: () => true,
        createCanvas: () => {
          throw new Error('Native capture must not create mirror canvas');
        },
        createMediaRecorder: () =>
          new FakeMediaRecorder() as unknown as MediaRecorder,
        createMediaStream: (tracks) =>
          ({
            getTracks: () => tracks,
            getVideoTracks: () => [],
            getAudioTracks: () => [],
          }) as unknown as MediaStream,
        requestAnimationFrame: () => {
          throw new Error('Native capture must not schedule mirror rAF');
        },
        cancelAnimationFrame: () => {},
      };

      const exporter = new CanvasVideoExporter(sourceCanvas, env, runtime);

      const result = exporter.startRecording({ preset: 'spotify-canvas' });
      expect(result.ok).toBe(true);
      expect(captures).toEqual([{ width: 1080, height: 1920 }]);
      expect(isRecordingActive()).toBe(true);

      await exporter.stopRecording();
      expect(restored).toBe(true);
      expect(isRecordingActive()).toBe(false);
    });

    it('renders native 1:1 square directly through runtime beginNativeCapture', async () => {
      const captures: Array<{ width: number; height: number }> = [];
      let restored = false;

      const runtime: CanvasVideoExportRuntime = {
        beginNativeCapture: ({ width, height }) => {
          captures.push({ width, height });
          return {
            ok: true,
            restore: () => {
              restored = true;
            },
          };
        },
        getAudioStream: () => null,
      };

      const sourceCanvas = {
        width: 800,
        height: 600,
        captureStream: () => ({
          getTracks: () => [],
          getVideoTracks: () => [],
          getAudioTracks: () => [],
        }),
      } as unknown as HTMLCanvasElement;

      class FakeMediaRecorder {
        mimeType = 'video/webm';
        ondataavailable: ((e: BlobEvent) => void) | null = null;
        onstop: (() => void) | null = null;
        start() {}
        stop() {
          this.onstop?.();
        }
      }

      const env: CanvasVideoExporterEnvironment = {
        mediaRecorderAvailable: true,
        isMimeTypeSupported: () => true,
        createCanvas: () => {
          throw new Error('Native capture must not create mirror canvas');
        },
        createMediaRecorder: () =>
          new FakeMediaRecorder() as unknown as MediaRecorder,
        createMediaStream: (tracks) =>
          ({
            getTracks: () => tracks,
            getVideoTracks: () => [],
            getAudioTracks: () => [],
          }) as unknown as MediaStream,
        requestAnimationFrame: () => {
          throw new Error('Native capture must not schedule mirror rAF');
        },
        cancelAnimationFrame: () => {},
      };

      const exporter = new CanvasVideoExporter(sourceCanvas, env, runtime);

      const result = exporter.startRecording({ preset: 'square-post' });
      expect(result.ok).toBe(true);
      expect(captures).toEqual([{ width: 1080, height: 1080 }]);
      expect(isRecordingActive()).toBe(true);

      await exporter.stopRecording();
      expect(restored).toBe(true);
      expect(isRecordingActive()).toBe(false);
    });
  });

  describe('background frame timer', () => {
    it('dispatches ticks and disposes cleanly', async () => {
      let ticks = 0;
      const timer = createBackgroundFrameTimer(() => {
        ticks += 1;
      }, 10);

      timer.start();
      await new Promise((resolve) => setTimeout(resolve, 50));
      timer.stop();
      const currentTicks = ticks;
      expect(currentTicks).toBeGreaterThan(0);

      // Verify stopping halts ticks
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(ticks).toBe(currentTicks);

      timer.dispose();
    });
  });
});
