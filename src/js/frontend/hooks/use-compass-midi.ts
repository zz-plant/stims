/**
 * WebMIDI joystick mapping for the aesthetic compass (#1682).
 *
 * CC 16 (x) and CC 17 (y) steer the puck; a short settle after the last
 * message commits the nearest preset, so a moving joystick does not fire a
 * preset change per CC tick. Absent WebMIDI (or permission) is a no-op.
 */
import { useEffect, useRef } from 'react';

export const COMPASS_MIDI_CC_X = 16;
export const COMPASS_MIDI_CC_Y = 17;
export const COMPASS_MIDI_SETTLE_MS = 250;

/** CC value 0..127 -> plane coordinate -1..1. */
export function midiCcToUnit(value: number): number {
  return Math.min(1, Math.max(-1, (value / 127) * 2 - 1));
}

export function useCompassMidi(
  onMove: (point: { x: number; y: number }, commit: boolean) => void,
  enabled = true,
) {
  const moveRef = useRef(onMove);
  moveRef.current = onMove;

  useEffect(() => {
    if (!enabled) return;
    if (
      typeof navigator === 'undefined' ||
      !('requestMIDIAccess' in navigator)
    ) {
      return;
    }
    let cancelled = false;
    let settle: ReturnType<typeof setTimeout> | null = null;
    const point = { x: 0, y: 0 };

    const onMessage = (event: MIDIMessageEvent) => {
      const data = event.data;
      if (!data || data.length < 3) return;
      const status = data[0] ?? 0;
      if ((status & 0xf0) !== 0xb0) return;
      const cc = data[1] ?? 0;
      const value = data[2] ?? 0;
      if (cc === COMPASS_MIDI_CC_X) point.x = midiCcToUnit(value);
      else if (cc === COMPASS_MIDI_CC_Y) point.y = midiCcToUnit(value);
      else return;
      moveRef.current({ ...point }, false);
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => {
        settle = null;
        moveRef.current({ ...point }, true);
      }, COMPASS_MIDI_SETTLE_MS);
    };

    void navigator
      .requestMIDIAccess()
      .then((access) => {
        if (cancelled) return;
        for (const input of access.inputs.values()) {
          input.addEventListener('midimessage', onMessage);
        }
        access.addEventListener?.('statechange', () => {
          for (const input of access.inputs.values()) {
            input.addEventListener('midimessage', onMessage);
          }
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (settle) clearTimeout(settle);
    };
  }, [enabled]);
}
