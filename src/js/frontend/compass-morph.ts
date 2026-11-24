/**
 * Compass morph: the stage follows the puck with a hand-driven crossfade.
 *
 * The compass used to switch to the nearest preset every 250 ms while
 * dragging, each switch a timed blend that ran on its own clock. This rides
 * the engine's manual crossfade instead (the cue deck's "Fade by hand"), so
 * the mix moves with the hand.
 *
 * A fade is armed when the puck enters another preset's cell, so it starts
 * at 0 and nothing jumps. Its position is the distance the puck has
 * travelled since, over `FADE_SPAN`. The span is in plane units, not cell
 * geometry: with a few thousand presets on the pad a cell is a few pixels
 * wide, so a fade tied to the cell edge would finish within one pointer
 * event. While a fade runs, the cells the puck crosses are ignored (the
 * engine has two decks, so it cannot retarget); when it completes, the next
 * arms from wherever the puck is.
 *
 * The position only moves forward: the engine cannot hand the stage back to
 * the outgoing preset. Release ramps an unfinished fade to the end within
 * `RELEASE_RAMP_MS`, then plays the preset under the puck if that differs,
 * with the ordinary transition.
 *
 * Pure state: the host supplies the engine calls and the clock, and calls
 * `tick()` each frame while `isBusy()`.
 */

/**
 * Puck travel, in plane units (the plane spans -1..1), that takes a fade
 * from 0 to 1: about a tenth of the pad's width.
 */
export const FADE_SPAN = 0.2;
/** A full fade ramps out in this long on release; a half-done one in half. */
export const RELEASE_RAMP_MS = 1200;
/**
 * How long an armed fade may wait for the engine to start it. The switch
 * starts once the incoming preset compiles; past this, the switch is taken
 * as having happened without a hand-driven fade (the gate refused it or the
 * load failed) and the morph lets go.
 */
export const ARM_TIMEOUT_MS = 4000;

export interface CompassMorphHost {
  /** Arm the engine's manual crossfade, then switch the stage to the preset. */
  startFade(presetId: string): void;
  /** Move the armed fade: 0 holds the outgoing preset, 1 completes it. */
  setPosition(position: number): void;
  /** The engine's fade position, or null when no manual fade is running. */
  getPosition(): number | null;
  /** Play a preset with the ordinary transition. */
  select(presetId: string): void;
  now(): number;
}

interface Fade {
  from: string;
  to: string;
  /** Where the puck was when the fade armed. */
  origin: { x: number; y: number };
  position: number;
  armedAt: number;
  /** The engine reported the fade running at least once. */
  live: boolean;
  /** Ramp start on release: [time, position]. */
  ramp: [number, number] | null;
}

export interface CompassMorph {
  /** Start a drag from the preset now on stage. */
  begin(stagePresetId: string | null): void;
  /** The puck moved to (x, y), over the cell of `nearestPresetId`. */
  update(nearestPresetId: string | null, x: number, y: number): void;
  /** The drag ended over `finalPresetId` (the nearest selectable preset). */
  release(finalPresetId: string | null): void;
  /** Advance the release ramp and watch the engine. Call once per frame. */
  tick(): void;
  /** Whether a fade or a pending final selection still needs `tick()`. */
  isBusy(): boolean;
  /** The preset the morph is fading to, else the one on stage. */
  stagePresetId(): string | null;
  /** Finish any fade at once; for unmount, so no fade is left half-way. */
  finish(): void;
}

export function createCompassMorph(host: CompassMorphHost): CompassMorph {
  let stage: string | null = null;
  let fade: Fade | null = null;
  let finalPick: string | null = null;
  let released = false;

  const push = (position: number) => {
    if (!fade) return;
    fade.position = Math.max(fade.position, Math.min(1, Math.max(0, position)));
    if (fade.live) host.setPosition(fade.position);
  };

  const settle = () => {
    if (!fade) return;
    stage = fade.to;
    fade = null;
  };

  const playFinal = () => {
    if (!released || fade) return;
    const pick = finalPick;
    finalPick = null;
    released = false;
    if (pick && pick !== stage) {
      stage = pick;
      host.select(pick);
    }
  };

  const watch = () => {
    if (!fade) return;
    const engine = host.getPosition();
    if (!fade.live) {
      if (engine !== null) {
        fade.live = true;
        // The engine starts every manual fade at 0; catch it up.
        host.setPosition(fade.position);
      } else if (host.now() - fade.armedAt > ARM_TIMEOUT_MS) {
        settle();
      }
      return;
    }
    // Live and now gone: completed at 1, or collapsed by another switch.
    if (engine === null) settle();
  };

  return {
    begin(stagePresetId) {
      if (!fade) stage = stagePresetId;
      released = false;
      finalPick = null;
    },

    update(nearestPresetId, x, y) {
      watch();
      if (fade) {
        if (fade.ramp) return;
        push(Math.hypot(x - fade.origin.x, y - fade.origin.y) / FADE_SPAN);
        return;
      }
      if (!stage || !nearestPresetId || nearestPresetId === stage) return;
      fade = {
        from: stage,
        to: nearestPresetId,
        origin: { x, y },
        position: 0,
        armedAt: host.now(),
        live: false,
        ramp: null,
      };
      host.startFade(nearestPresetId);
    },

    release(finalPresetId) {
      released = true;
      finalPick = finalPresetId;
      if (fade && !fade.ramp) fade.ramp = [host.now(), fade.position];
      playFinal();
    },

    tick() {
      if (fade?.ramp) {
        const [startedAt, from] = fade.ramp;
        const span = RELEASE_RAMP_MS * (1 - from);
        const elapsed = host.now() - startedAt;
        push(span <= 0 ? 1 : from + (elapsed / span) * (1 - from));
      }
      watch();
      playFinal();
    },

    isBusy: () => fade !== null || released,

    stagePresetId: () => fade?.to ?? stage,

    finish() {
      if (fade) {
        // Live even if no tick has seen it yet: the switch may have started.
        if (fade.live || host.getPosition() !== null) host.setPosition(1);
        settle();
      }
      released = false;
      finalPick = null;
    },
  };
}
