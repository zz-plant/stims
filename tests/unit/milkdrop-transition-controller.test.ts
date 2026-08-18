import { describe, expect, test } from 'bun:test';
import { createMilkdropTransitionController } from '../../src/js/milkdrop/runtime/transition-controller.ts';
import type { MilkdropBlendState } from '../../src/js/milkdrop/types.ts';

function blendPayload(): MilkdropBlendState {
  return {
    mode: 'gpu',
    previousFrame: { presetId: 'outgoing' } as never,
    alpha: 1,
  };
}

const tickDefaults = { canBlendThisFrame: true, presentable: true };

describe('milkdrop transition controller', () => {
  test('advances alpha on sim time and reuses the blend payload', () => {
    const controller = createMilkdropTransitionController();
    const payload = blendPayload();
    controller.begin(payload, 2);

    // First tick establishes the clock; no time has passed yet.
    const first = controller.tick({ ...tickDefaults, now: 1000 });
    expect(first).toBe(payload);
    expect(first?.alpha).toBe(1);

    // Ten 100ms frames = 1s of the 2s blend.
    let mid = first;
    for (let now = 1100; now <= 2000; now += 100) {
      mid = controller.tick({ ...tickDefaults, now });
    }
    expect(mid).toBe(payload);
    expect(mid?.alpha).toBeCloseTo(0.5, 5);

    let settled = false;
    for (let now = 2100; now <= 3200; now += 100) {
      if (controller.tick({ ...tickDefaults, now }) === null) {
        settled = true;
        break;
      }
    }
    expect(settled).toBe(true);
    expect(controller.getPhase()).toBe('idle');
  });

  test('a cut settles immediately', () => {
    const controller = createMilkdropTransitionController();
    controller.begin(null, 2);
    expect(controller.getPhase()).toBe('idle');
    expect(controller.tick({ ...tickDefaults, now: 1000 })).toBeNull();
  });

  test('a pause contributes at most one clamped step', () => {
    const controller = createMilkdropTransitionController();
    controller.begin(blendPayload(), 2);
    controller.tick({ ...tickDefaults, now: 1000 });

    // Hidden tab for 30 seconds: the old wall-clock math would have ended
    // the blend; sim time treats it as a single 100ms step.
    const resumed = controller.tick({ ...tickDefaults, now: 31000 });
    expect(resumed?.alpha).toBeCloseTo(0.95, 5);
  });

  test('a gated frame suspends progress instead of racing past it', () => {
    const controller = createMilkdropTransitionController();
    controller.begin(blendPayload(), 2);
    controller.tick({ ...tickDefaults, now: 1000 });
    controller.tick({ ...tickDefaults, now: 1500 });

    // Workload gate fails for a stretch: no cover those frames...
    expect(
      controller.tick({ ...tickDefaults, now: 2000, canBlendThisFrame: false }),
    ).toBeNull();
    expect(
      controller.tick({ ...tickDefaults, now: 2500, canBlendThisFrame: false }),
    ).toBeNull();

    // ...and the blend resumes near where it left off (only clamped steps
    // advanced: 0.1s at 1500 and 0.1s re-entering at 3000), not at the
    // wall-clock position, which would already be past 1.0s elapsed.
    const resumed = controller.tick({ ...tickDefaults, now: 3000 });
    expect(resumed?.alpha).toBeCloseTo(0.9, 5);
  });

  test('holds the reveal while the preset is not presentable, then releases', () => {
    const controller = createMilkdropTransitionController();
    controller.begin(blendPayload(), 1);
    controller.tick({ ...tickDefaults, now: 0 });

    // Run to below the hold floor while the shader swap is pending.
    let state = controller.tick({
      ...tickDefaults,
      now: 700,
      presentable: false,
    });
    for (let now = 800; now <= 1600; now += 100) {
      state = controller.tick({ ...tickDefaults, now, presentable: false });
      expect(state).not.toBeNull();
      // Never drops below the hold floor while pending.
      expect(state?.alpha ?? 0).toBeGreaterThanOrEqual(0.35);
    }

    // Swap lands: the blend resumes and finishes.
    let sawRelease = false;
    for (let now = 1700; now <= 3200; now += 100) {
      const ticked = controller.tick({ ...tickDefaults, now });
      if (ticked === null) {
        sawRelease = true;
        break;
      }
    }
    expect(sawRelease).toBe(true);
    expect(controller.getEvents().some((e) => e.event === 'reveal-held')).toBe(
      true,
    );
  });

  test('the presentable hold is capped so a wedged swap cannot pin the cover', () => {
    const controller = createMilkdropTransitionController();
    controller.begin(blendPayload(), 1);
    controller.tick({ ...tickDefaults, now: 0 });

    let settled = false;
    // Swap never lands; the hold cap (2s) must release the blend anyway.
    for (let now = 100; now <= 6000; now += 100) {
      if (
        controller.tick({ ...tickDefaults, now, presentable: false }) === null
      ) {
        settled = true;
        break;
      }
    }
    expect(settled).toBe(true);
  });

  test('cancel abandons the blend and records the reason', () => {
    const controller = createMilkdropTransitionController();
    controller.begin(blendPayload(), 2);
    controller.tick({ ...tickDefaults, now: 1000 });
    controller.cancel('backend fallback');
    expect(controller.getPhase()).toBe('idle');
    expect(controller.tick({ ...tickDefaults, now: 1100 })).toBeNull();
    expect(controller.getEvents().some((e) => e.event === 'cancelled')).toBe(
      true,
    );
  });
});
