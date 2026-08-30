import { describe, expect, test } from 'bun:test';
import {
  OfflineFrameRenderer,
  type OfflineSteppableEngine,
} from '../../src/js/utils/media/offline-frame-renderer.ts';

describe('offline frame renderer', () => {
  test('renders deterministic frame sequences with progress reporting', async () => {
    let stepsCount = 0;
    let rendersCount = 0;

    const mockEngine: OfflineSteppableEngine = {
      stepFrame(_deltaSeconds: number) {
        stepsCount++;
      },
      renderToCanvas(_canvas: HTMLCanvasElement) {
        rendersCount++;
      },
    };

    const progressReports: number[] = [];
    const renderer = new OfflineFrameRenderer();

    const frames = await renderer.renderSequence(mockEngine, {
      width: 1920,
      height: 1080,
      fps: 30,
      durationSeconds: 0.5, // 15 frames
      onProgress(p) {
        progressReports.push(p.percent);
      },
    });

    expect(frames.length).toBe(15);
    expect(stepsCount).toBe(15);
    expect(rendersCount).toBe(15);
    expect(progressReports.length).toBe(15);
    expect(progressReports[progressReports.length - 1]).toBe(100);
  });

  test('can cancel sequence rendering early', async () => {
    const mockEngine: OfflineSteppableEngine = {
      stepFrame() {},
      renderToCanvas() {},
    };

    const renderer = new OfflineFrameRenderer();
    const renderPromise = renderer.renderSequence(mockEngine, {
      width: 1280,
      height: 720,
      fps: 60,
      durationSeconds: 10,
    });

    renderer.cancel();
    const frames = await renderPromise;
    expect(frames.length).toBeLessThan(600);
  });
});
