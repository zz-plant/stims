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

describe('hand-driven crossfade', () => {
  test('cover opacity follows the fader instead of a clock', () => {
    const controller = createMilkdropTransitionController();
    const payload = blendPayload();
    controller.beginManual(payload);
    expect(controller.getPhase()).toBe('manual');

    // Time passing on its own must move nothing: this fade is a gesture.
    expect(controller.tick({ ...tickDefaults, now: 1000 })?.alpha).toBeCloseTo(
      1,
      5,
    );
    expect(controller.tick({ ...tickDefaults, now: 9000 })?.alpha).toBeCloseTo(
      1,
      5,
    );

    controller.setManualPosition(0.25);
    expect(controller.tick({ ...tickDefaults, now: 9100 })?.alpha).toBeCloseTo(
      0.75,
      5,
    );

    // A fader can go backwards; a timed blend cannot.
    controller.setManualPosition(0.1);
    expect(controller.tick({ ...tickDefaults, now: 9200 })?.alpha).toBeCloseTo(
      0.9,
      5,
    );
  });

  test('clamps overshoot from pointer and MIDI input', () => {
    const controller = createMilkdropTransitionController();
    controller.beginManual(blendPayload());

    controller.setManualPosition(-3);
    expect(controller.getManualPosition()).toBe(0);
    controller.setManualPosition(4);
    expect(controller.getManualPosition()).toBe(1);
  });

  test('settles once the fader completes the switch', () => {
    const controller = createMilkdropTransitionController();
    controller.beginManual(blendPayload());
    controller.setManualPosition(1);

    expect(controller.tick({ ...tickDefaults, now: 1000 })).toBeNull();
    expect(controller.getPhase()).toBe('idle');
  });

  test('refuses to reveal a deck whose shaders have not warmed', () => {
    const controller = createMilkdropTransitionController();
    controller.beginManual(blendPayload());
    // Pushed all the way over, but the incoming preset is not presentable:
    // the cover holds at the floor rather than showing pass-through styling.
    controller.setManualPosition(1);

    const held = controller.tick({
      now: 1000,
      canBlendThisFrame: true,
      presentable: false,
    });
    expect(held?.alpha).toBeCloseTo(0.35, 5);

    // Once it warms, the same fader position completes the switch.
    expect(controller.tick({ ...tickDefaults, now: 1100 })).toBeNull();
    expect(controller.getPhase()).toBe('idle');
  });

  test('gives up on the hold rather than wedging the fade forever', () => {
    const controller = createMilkdropTransitionController();
    controller.beginManual(blendPayload());
    controller.setManualPosition(1);

    controller.tick({ now: 1000, canBlendThisFrame: true, presentable: false });
    // Past the cap, a swap that never becomes presentable must not leave the
    // performer unable to finish the gesture.
    expect(
      controller.tick({
        now: 4000,
        canBlendThisFrame: true,
        presentable: false,
      }),
    ).toBeNull();
    expect(controller.getPhase()).toBe('idle');
  });

  test('a suspended frame holds position instead of snapping', () => {
    const controller = createMilkdropTransitionController();
    controller.beginManual(blendPayload());
    controller.setManualPosition(0.4);

    // Workload spike: no cover this frame...
    expect(
      controller.tick({
        now: 1000,
        canBlendThisFrame: false,
        presentable: true,
      }),
    ).toBeNull();
    // ...and the gesture resumes exactly where the hand left it.
    expect(controller.tick({ ...tickDefaults, now: 1100 })?.alpha).toBeCloseTo(
      0.6,
      5,
    );
  });
});

describe('manual fades survive the duplicate begin', () => {
  test('a timed begin cannot replace a hand-driven fade in progress', () => {
    const controller = createMilkdropTransitionController();
    controller.beginManual(blendPayload());
    controller.setManualPosition(0.3);

    // One preset switch calls beginPresetTransition twice — navigation
    // controller and editor-session subscriber. The second call must not
    // take the fader out of the performer's hand.
    controller.begin(blendPayload(), 2);

    expect(controller.getPhase()).toBe('manual');
    expect(controller.getManualPosition()).toBe(0.3);
    expect(controller.tick({ ...tickDefaults, now: 1000 })?.alpha).toBeCloseTo(
      0.7,
      5,
    );
  });

  test('a cut cannot silently cancel a hand-driven fade either', () => {
    const controller = createMilkdropTransitionController();
    controller.beginManual(blendPayload());
    controller.begin(null, 0);

    expect(controller.getPhase()).toBe('manual');
  });
});
