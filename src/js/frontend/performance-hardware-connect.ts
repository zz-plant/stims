/**
 * Tells you that the controller you just plugged in is doing something.
 *
 * Two features hung off hardware that never announced itself. A MIDI device
 * has driven zoom/warp/rot/decay/q1-q4 out of the box since
 * `DEFAULT_MIDI_CC_BINDINGS` shipped, and a gamepad's sticks and triggers
 * reach the same binding machinery through the `virtual:gamepad` device — but
 * nothing anywhere said so. The only mention of either lives in Settings ->
 * Performance hardware, which is exactly the panel you do not open when you
 * have no reason to think the app knows about your hardware. So the whole
 * capability was reachable only by a performer who moved a fader on a hunch.
 *
 * This module is the hunch, removed: connecting a controller says what it now
 * drives and where to change it, once per device per session.
 *
 * It also applies the factory mapping for controllers we ship a profile for
 * (`midi-controller-presets.ts`), which until now was imported by nothing —
 * a nanoKONTROL2 got the same eight anonymous defaults as any other device
 * and its sixteen labelled controls had to be learned one at a time.
 */

import {
  DEFAULT_MIDI_CC_BINDINGS,
  type MidiBindingMap,
  type MidiDeviceInfo,
  type MidiNoteBindingMap,
} from '../core/services/webmidi-controller.ts';
import { matchMidiProfile } from './midi-controller-presets.ts';

/**
 * The slice of the MIDI service this needs.
 *
 * Structural rather than the concrete service so tests can drive it with a
 * stub — mocking a module in this graph and re-importing it is a known way to
 * hang `bun test` here.
 */
export interface PerformanceHardwareMidi {
  onDevicesChanged: (
    listener: (devices: MidiDeviceInfo[]) => void,
  ) => () => void;
  getDevices: () => MidiDeviceInfo[];
  getBindings: (deviceId: string) => MidiBindingMap;
  applyDeviceProfile: (
    deviceId: string,
    bindings: MidiBindingMap,
    noteBindings?: MidiNoteBindingMap,
  ) => void;
}

/** True when nobody has touched this device's mapping since it appeared. */
function isAtServiceDefaults(bindings: MidiBindingMap): boolean {
  const ccNumbers = Object.keys(bindings);
  const defaultCcNumbers = Object.keys(DEFAULT_MIDI_CC_BINDINGS);
  if (ccNumbers.length !== defaultCcNumbers.length) return false;
  return defaultCcNumbers.every((cc) => {
    const mine = bindings[Number(cc)];
    const theirs = DEFAULT_MIDI_CC_BINDINGS[Number(cc)];
    return (
      mine != null &&
      mine.target === theirs.target &&
      mine.min === theirs.min &&
      mine.max === theirs.max
    );
  });
}

/**
 * What the generic defaults actually do, spelled out.
 *
 * Named constants rather than an interpolation over the binding map: the
 * message has to read like a sentence a performer can act on, and generating
 * "CC 1 drives zoom, CC 2 drives warp, ..." from eight entries produces a
 * paragraph nobody finishes.
 */
const DEFAULT_BINDING_SUMMARY =
  'CC 1-4 and 7-10 drive zoom, warp, rotation, decay and q1-q4';

export function describeMidiConnection(
  device: MidiDeviceInfo,
  profileDescription: string | null,
  profileName: string | null,
): string {
  const label = profileName ?? device.name;
  if (profileDescription) {
    return `${label} connected — ${profileDescription} Settings → Performance hardware to remap.`;
  }
  return `${label} connected — ${DEFAULT_BINDING_SUMMARY}. Settings → Performance hardware to remap or learn your own.`;
}

export const GAMEPAD_CONNECTED_MESSAGE =
  'Controller connected — sticks nudge and rotate the visuals, triggers drive q1 and q2. Settings → Performance hardware to remap.';

export interface WatchPerformanceHardwareOptions {
  midi: PerformanceHardwareMidi;
  announce: (message: string) => void;
  /** Injected for tests; defaults to the real window. */
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}

/**
 * Start watching for controllers. Returns a teardown.
 *
 * Announcements are once per device per session, keyed by device id, because
 * `onDevicesChanged` is the service's general "MIDI state changed" signal —
 * it also fires on every learned binding and enable toggle, and re-announcing
 * a controller each time someone maps a knob would be its own bug.
 */
export function watchPerformanceHardware({
  midi,
  announce,
  target = typeof window === 'undefined' ? null : window,
}: WatchPerformanceHardwareOptions): () => void {
  const announced = new Set<string>();

  const handleDevices = (devices: MidiDeviceInfo[]) => {
    for (const device of devices) {
      if (device.kind !== 'hardware' || device.state !== 'connected') continue;
      if (announced.has(device.id)) continue;
      announced.add(device.id);

      const profile = matchMidiProfile(device.name, device.manufacturer);
      // Only ever overwrite the mapping the service itself installed. A
      // performer who has already learned their own knobs owns that device,
      // and a profile arriving later must not silently replace their work.
      const fresh = isAtServiceDefaults(midi.getBindings(device.id));
      const applied = profile != null && fresh;
      if (applied) {
        midi.applyDeviceProfile(
          device.id,
          profile.ccBindings,
          profile.noteBindings,
        );
      }
      announce(
        describeMidiConnection(
          device,
          applied ? profile.description : null,
          applied ? profile.name : null,
        ),
      );
    }
  };

  const unsubscribe = midi.onDevicesChanged(handleDevices);
  // A device present before this ran (the service initialises on idle, and
  // Settings may have connected MIDI already) never fires the change event.
  handleDevices(midi.getDevices());

  let gamepadAnnounced = false;
  const handleGamepad = () => {
    if (gamepadAnnounced) return;
    gamepadAnnounced = true;
    announce(GAMEPAD_CONNECTED_MESSAGE);
  };
  target?.addEventListener('gamepadconnected', handleGamepad);

  return () => {
    unsubscribe();
    target?.removeEventListener('gamepadconnected', handleGamepad);
  };
}
