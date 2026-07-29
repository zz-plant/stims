import { describe, expect, test } from 'bun:test';
import * as capturedVideoReactivity from '../../src/js/milkdrop/runtime/captured-video-reactivity.ts';

const { createMilkdropCapturedVideoReactivityTracker } =
  capturedVideoReactivity;

describe('milkdrop captured video reactivity', () => {
  test('skips reactive DSP while no captured video is ready', () => {
    const resolveReactivity = (
      capturedVideoReactivity as typeof capturedVideoReactivity & {
        updateCapturedVideoReactivityIfReady?: (
          capturedVideoReady: boolean,
          tracker: {
            update: (args: { signals: object }) => { bassPulse: number };
          },
          signals: object,
          current: { bassPulse: number },
        ) => { bassPulse: number };
      }
    ).updateCapturedVideoReactivityIfReady;
    expect(resolveReactivity).toBeFunction();
    if (!resolveReactivity) return;

    const current = { bassPulse: 0 };
    let updateCalls = 0;
    const result = resolveReactivity(
      false,
      {
        update: () => {
          updateCalls += 1;
          return { bassPulse: 1 };
        },
      },
      {},
      current,
    );

    expect(updateCalls).toBe(0);
    expect(result).toBe(current);
  });

  test('holds energy on release longer than it rises on attack', () => {
    const tracker = createMilkdropCapturedVideoReactivityTracker();

    const attack = tracker.update({
      signals: {
        time: 1,
        deltaMs: 16,
        bass: 1,
        bassAtt: 1,
        mid: 0,
        midAtt: 0,
        midsAtt: 0,
        treble: 0,
        trebleAtt: 0,
        weightedEnergy: 1,
        beatPulse: 0,
      },
    });
    const release = tracker.update({
      signals: {
        time: 1.016,
        deltaMs: 16,
        bass: 0,
        bassAtt: 0,
        mid: 0,
        midAtt: 0,
        midsAtt: 0,
        treble: 0,
        trebleAtt: 0,
        weightedEnergy: 0,
        beatPulse: 0,
      },
    });

    expect(attack.energyWash).toBeGreaterThan(0);
    expect(release.energyWash).toBeGreaterThan(0);
    expect(release.energyWash).toBeGreaterThan(attack.energyWash * 0.75);
  });

  test('maps bass to size and treble to ghost separation', () => {
    const bassTracker = createMilkdropCapturedVideoReactivityTracker();
    const trebleTracker = createMilkdropCapturedVideoReactivityTracker();

    const bassHeavy = bassTracker.update({
      signals: {
        time: 6,
        deltaMs: 16,
        bass: 1,
        bassAtt: 1,
        mid: 0.2,
        midAtt: 0.2,
        midsAtt: 0.2,
        treble: 0.05,
        trebleAtt: 0.05,
        weightedEnergy: 0.8,
        beatPulse: 0.3,
      },
    });
    const trebleHeavy = trebleTracker.update({
      signals: {
        time: 6,
        deltaMs: 16,
        bass: 0.05,
        bassAtt: 0.05,
        mid: 0.2,
        midAtt: 0.2,
        midsAtt: 0.2,
        treble: 1,
        trebleAtt: 1,
        weightedEnergy: 0.8,
        beatPulse: 0.3,
      },
    });

    expect(bassHeavy.overlayWidthScale).toBeGreaterThan(
      trebleHeavy.overlayWidthScale,
    );
    expect(trebleHeavy.ghostOffsetX).toBeGreaterThan(bassHeavy.ghostOffsetX);
    expect(trebleHeavy.ghostOpacity).toBeGreaterThan(bassHeavy.ghostOpacity);
  });

  test('uses mids to drive lateral drift more than bass alone', () => {
    const bassTracker = createMilkdropCapturedVideoReactivityTracker();
    const midTracker = createMilkdropCapturedVideoReactivityTracker();

    const bassHeavy = bassTracker.update({
      signals: {
        time: 9,
        deltaMs: 16,
        bass: 0.9,
        bassAtt: 0.9,
        mid: 0.05,
        midAtt: 0.05,
        midsAtt: 0.05,
        treble: 0.1,
        trebleAtt: 0.1,
        weightedEnergy: 0.7,
        beatPulse: 0.2,
      },
    });
    const midHeavy = midTracker.update({
      signals: {
        time: 9,
        deltaMs: 16,
        bass: 0.05,
        bassAtt: 0.05,
        mid: 0.9,
        midAtt: 0.9,
        midsAtt: 0.9,
        treble: 0.1,
        trebleAtt: 0.1,
        weightedEnergy: 0.7,
        beatPulse: 0.2,
      },
    });

    expect(Math.abs(midHeavy.overlayDriftX)).toBeGreaterThan(
      Math.abs(bassHeavy.overlayDriftX),
    );
    expect(Math.abs(midHeavy.overlayRotation)).toBeGreaterThan(
      Math.abs(bassHeavy.overlayRotation),
    );
  });
});
