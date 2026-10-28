/**
 * What recording needs from the rest of the app: the stage's presentation
 * carried into the file, the recording flag, and the Record action. The
 * recorder itself (presets, native capture, audio, the copy) is proven in
 * packages/canvas-video-exporter/tests/.
 */
import { beforeEach, describe, expect, it, test } from 'bun:test';
import type { CanvasVideoExporterEnvironment } from 'canvas-video-exporter';
import { notifyFrameDrawn } from '../../src/js/core/frame-drawn.ts';
import {
  isRecordingActive,
  resetRecordingActiveForTests,
} from '../../src/js/core/services/recording-state.ts';
import {
  resetStageLuminance,
  setStageLuminanceChannel,
} from '../../src/js/core/services/stage-luminance.ts';
import {
  handleFlashKeyDown,
  resetStageUtilitiesForTests,
} from '../../src/js/core/services/stage-utilities.ts';
import { createStageVideoExporter } from '../../src/js/frontend/engine/stage-video-exporter.ts';
import { openRecordPanel } from '../../src/js/frontend/workspace-actions.ts';
import {
  type GreyCanvas,
  greyCanvas,
  greyCanvasFactory,
} from '../grey-canvas.ts';

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

function fakeEnvironment(seen: {
  recorded: GreyCanvas | null;
}): CanvasVideoExporterEnvironment {
  return {
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
}

describe('the stage video exporter', () => {
  beforeEach(() => {
    resetRecordingActiveForTests();
  });

  it('records a preset-sized copy painted from the frame-drawn notification, and flags the recording', async () => {
    const seen: { recorded: GreyCanvas | null } = { recorded: null };
    const source = greyCanvas(200, { width: 800, height: 600 });
    const exporter = createStageVideoExporter({
      canvas: source,
      environment: fakeEnvironment(seen),
    });

    expect(exporter.startRecording({ preset: 'spotify-canvas' }).ok).toBe(true);
    expect(isRecordingActive()).toBe(true);
    expect(source.width).toBe(800);
    const recorded = seen.recorded as GreyCanvas;
    expect([recorded.width, recorded.height]).toEqual([1080, 1920]);

    // Painted with the stage's own frames, the one moment it can be read.
    notifyFrameDrawn(0);
    expect(recorded.level).toBe(200);
    source.level = 90;
    notifyFrameDrawn(16);
    expect(recorded.level).toBe(90);

    await exporter.stopRecording();
    expect(isRecordingActive()).toBe(false);
    source.level = 10;
    notifyFrameDrawn(32);
    expect(recorded.level).not.toBe(10);
  });

  it('carries the governor dimming and the stage cuts, but not the brightness ceiling', async () => {
    const stage = document.createElement('div');
    const seen: { recorded: GreyCanvas | null } = { recorded: null };
    const exporter = createStageVideoExporter({
      canvas: greyCanvas(200),
      environment: fakeEnvironment(seen),
      getStage: () => stage,
    });
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
