import { describe, expect, test } from 'bun:test';
import { resolveCapturedVideoOverlayLayout } from '../assets/js/milkdrop/runtime/captured-video-overlay.ts';
import { createMilkdropCapturedVideoReactivityTracker } from '../assets/js/milkdrop/runtime/captured-video-reactivity.ts';

describe('milkdrop captured video overlay layout', () => {
  test('keeps the overlay in the upper-right camera frustum with sane opacity bounds', () => {
    const tracker = createMilkdropCapturedVideoReactivityTracker();
    const layout = resolveCapturedVideoOverlayLayout({
      aspect: 16 / 9,
      fov: 75,
      reactivity: tracker.update({
        signals: {
          time: 12,
          deltaMs: 16,
          bass: 0.8,
          bassAtt: 0.85,
          mid: 0.5,
          midAtt: 0.55,
          midsAtt: 0.55,
          treble: 0.4,
          trebleAtt: 0.45,
          weightedEnergy: 0.8,
          beatPulse: 0.4,
        },
      }),
    });

    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    expect(layout.x).toBeGreaterThan(0);
    expect(layout.y).toBeGreaterThan(0);
    expect(layout.baseOpacity).toBeGreaterThanOrEqual(0.12);
    expect(layout.baseOpacity).toBeLessThanOrEqual(0.34);
    expect(layout.ghostOpacity).toBeGreaterThanOrEqual(0.1);
    expect(layout.ghostOpacity).toBeLessThanOrEqual(0.28);
  });

  test('uses a larger relative footprint on portrait-ish layouts', () => {
    const tracker = createMilkdropCapturedVideoReactivityTracker();
    const reactivity = tracker.update({
      signals: {
        time: 2,
        deltaMs: 16,
        bass: 0.2,
        bassAtt: 0.22,
        mid: 0.2,
        midAtt: 0.22,
        midsAtt: 0.22,
        treble: 0.15,
        trebleAtt: 0.18,
        weightedEnergy: 0.2,
        beatPulse: 0.1,
      },
    });
    const desktop = resolveCapturedVideoOverlayLayout({
      aspect: 16 / 9,
      fov: 75,
      reactivity,
    });
    const portrait = resolveCapturedVideoOverlayLayout({
      aspect: 0.7,
      fov: 75,
      reactivity,
    });

    expect(portrait.width / portrait.height).toBeGreaterThan(1.7);
    expect(portrait.width / portrait.height).toBeLessThan(1.85);
    expect(portrait.width).toBeLessThan(desktop.width);
    expect(portrait.y).toBeGreaterThan(0);
  });
});
