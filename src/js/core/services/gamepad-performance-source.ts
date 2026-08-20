/**
 * A gamepad as a performance surface.
 *
 * `utils/browser/gamepad-navigation.ts` already reads gamepads, but only to
 * move focus and activate buttons — it drives the UI, never a preset value.
 * This turns sticks, triggers, and buttons into bindable controls.
 *
 * It deliberately does NOT introduce a second mapping system. The gamepad is
 * injected into the MIDI service as the `virtual:gamepad` device, exactly the
 * way Claude is injected as `virtual:claude`, so MIDI-learn, per-device
 * enable/disable, persisted bindings, and the editor's "MIDI is driving this"
 * gutter all work on a gamepad with no extra code.
 *
 * Layout (standard gamepad mapping):
 *   CC 0-3   left stick X/Y, right stick X/Y   (-1..1 mapped to 0..127)
 *   CC 4-5   left/right analog triggers        (0..1 mapped to 0..127)
 *   note 0-N face/shoulder/dpad buttons, in the browser's button order
 */

import {
  VIRTUAL_GAMEPAD_DEVICE_ID,
  type WebMidiControllerService,
} from './webmidi-controller.ts';

/** Sticks rest slightly off-centre and jitter; below this they read as 0. */
const AXIS_DEADZONE = 0.12;
/** Analog triggers idle at a small nonzero value on some pads. */
const TRIGGER_DEADZONE = 0.04;
/**
 * Quantisation step below which a change is not worth emitting. Axis noise
 * would otherwise push a CC message every frame for a stick nobody touched,
 * and each one runs the whole binding + apply + feedback path.
 */
const CC_EPSILON = 1;
/** Analog trigger indices in the standard mapping. */
const LEFT_TRIGGER_BUTTON = 6;
const RIGHT_TRIGGER_BUTTON = 7;
const TRIGGER_CC = { [LEFT_TRIGGER_BUTTON]: 4, [RIGHT_TRIGGER_BUTTON]: 5 };

export type GamepadPerformanceOptions = {
  /** Poll callback scheduler; overridable so tests need no rAF. */
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  getGamepads?: () => Array<Gamepad | null>;
};

type MidiSink = Pick<
  WebMidiControllerService,
  'injectControlChange' | 'injectNote'
>;

export function isGamepadPerformanceSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.getGamepads;
}

function axisToCc(value: number): number {
  const settled = Math.abs(value) < AXIS_DEADZONE ? 0 : value;
  // -1..1 to 0..127, so a centred stick sits at the midpoint rather than at
  // the bottom of the bound parameter's range.
  return Math.round(((settled + 1) / 2) * 127);
}

function triggerToCc(value: number): number {
  const settled = value < TRIGGER_DEADZONE ? 0 : value;
  return Math.round(settled * 127);
}

/**
 * Polls the first connected gamepad and injects its motion into `midi`.
 * Returns a stop function. Safe to start when no gamepad is attached — it
 * simply emits nothing until one appears.
 */
export function startGamepadPerformanceSource(
  midi: MidiSink,
  options: GamepadPerformanceOptions = {},
): () => void {
  const requestFrame =
    options.requestFrame ??
    ((callback: () => void) => requestAnimationFrame(callback));
  const cancelFrame =
    options.cancelFrame ?? ((handle: number) => cancelAnimationFrame(handle));
  const readGamepads =
    options.getGamepads ?? (() => Array.from(navigator.getGamepads?.() ?? []));

  const lastCc = new Map<number, number>();
  const lastButtons = new Map<number, boolean>();
  let handle: number | null = null;
  let stopped = false;

  const emitCc = (cc: number, value: number) => {
    const previous = lastCc.get(cc);
    if (previous !== undefined && Math.abs(previous - value) < CC_EPSILON) {
      return;
    }
    lastCc.set(cc, value);
    midi.injectControlChange(VIRTUAL_GAMEPAD_DEVICE_ID, cc, value);
  };

  const poll = () => {
    if (stopped) return;
    const pad =
      readGamepads().find((candidate) => candidate?.connected) ?? null;
    if (pad) {
      for (let axis = 0; axis < Math.min(pad.axes.length, 4); axis += 1) {
        emitCc(axis, axisToCc(pad.axes[axis] ?? 0));
      }
      for (let index = 0; index < pad.buttons.length; index += 1) {
        const button = pad.buttons[index];
        if (!button) continue;
        const triggerCc = TRIGGER_CC[index as keyof typeof TRIGGER_CC];
        if (triggerCc !== undefined) {
          // Triggers are analog on every modern pad: send position, not just
          // pressed/released, so they can ride a parameter.
          emitCc(triggerCc, triggerToCc(button.value));
          continue;
        }
        const pressed = button.pressed;
        if (lastButtons.get(index) === pressed) continue;
        lastButtons.set(index, pressed);
        midi.injectNote(
          VIRTUAL_GAMEPAD_DEVICE_ID,
          index,
          pressed,
          pressed ? 127 : 0,
        );
      }
    }
    handle = requestFrame(poll);
  };

  handle = requestFrame(poll);

  return () => {
    stopped = true;
    if (handle !== null) cancelFrame(handle);
    handle = null;
  };
}
