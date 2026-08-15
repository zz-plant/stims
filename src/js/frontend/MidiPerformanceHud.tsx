import { useEffect, useRef, useState } from 'react';
import { webMidiService } from '../core/services/webmidi-controller.ts';
import { isFieldShadowedByEquations } from '../milkdrop/formatter.ts';
import { useEngineSnapshot } from './engine-context.tsx';

/**
 * The dots in Settings and the gutter glyphs in the code editor both answer
 * "is this binding going to work" — useful while setting a mapping up, but
 * invisible during the moment that actually matters: turning a knob while
 * watching the stage, with every panel closed. This is the same live/
 * shadowed signal, just surfaced where a performer is actually looking.
 * Renders nothing until audio is live and at least one enabled device has
 * a binding, so non-MIDI users never see it.
 */
export function MidiPerformanceHud() {
  const { engineSnapshot } = useEngineSnapshot();
  const activeSource = engineSnapshot?.currentSource ?? '';
  const [targets, setTargets] = useState<string[]>(() => [
    ...webMidiService.getEnabledTargets(),
  ]);
  const valuesRef = useRef<Map<string, number>>(new Map());
  const [, forceTick] = useState(0);
  const pendingTickRef = useRef<number | null>(null);

  useEffect(
    () =>
      webMidiService.onDevicesChanged(() => {
        setTargets([...webMidiService.getEnabledTargets()]);
      }),
    [],
  );

  useEffect(() => {
    // CC messages can arrive far faster than is useful to paint — batch
    // updates onto one 100ms tick, matching the debounce cadence already
    // used elsewhere in the live-patch pipeline.
    const unsubscribe = webMidiService.onControlChange(
      (_cc, _raw, target, normalized) => {
        if (
          !target ||
          normalized === undefined ||
          !Number.isFinite(normalized)
        ) {
          return;
        }
        valuesRef.current.set(target, normalized);
        if (pendingTickRef.current !== null) return;
        pendingTickRef.current = window.setTimeout(() => {
          pendingTickRef.current = null;
          forceTick((n) => n + 1);
        }, 100);
      },
    );
    return () => {
      unsubscribe();
      if (pendingTickRef.current !== null) {
        window.clearTimeout(pendingTickRef.current);
      }
    };
  }, []);

  if (!engineSnapshot?.audioActive || targets.length === 0) {
    return null;
  }

  return (
    <div
      className="stims-shell__midi-hud"
      role="status"
      aria-label="Live MIDI performance status"
    >
      {targets.map((target) => {
        const value = valuesRef.current.get(target);
        const shadowed = activeSource
          ? isFieldShadowedByEquations(activeSource, target)
          : null;
        return (
          <span
            key={target}
            className="stims-shell__midi-hud-chip"
            title={
              shadowed
                ? `${target} is overridden by this preset's own equations every frame — this binding has no visible effect.`
                : `MIDI/MCP is driving ${target}.`
            }
          >
            <span
              className={
                shadowed === null
                  ? 'stims-shell__midi-hud-dot'
                  : `stims-shell__midi-hud-dot stims-shell__midi-hud-dot--${shadowed ? 'shadowed' : 'live'}`
              }
            />
            <span className="stims-shell__midi-hud-label">{target}</span>
            <span className="stims-shell__midi-hud-value">
              {value === undefined ? '—' : value.toFixed(2)}
            </span>
          </span>
        );
      })}
    </div>
  );
}
