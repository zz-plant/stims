import { useEffect, useRef, useState } from 'react';
import { webMidiService } from '../core/services/webmidi-controller.ts';
import { useEngineSnapshot } from './engine-context.tsx';
import { listModulators } from './live-modulation.ts';
import {
  describeParameterState,
  parameterStateLabel,
} from './parameter-state.ts';

/**
 * What is driving your parameters right now, while you are looking at the
 * stage rather than at a panel.
 *
 * This began as a MIDI-only readout, which left the more dangerous case
 * invisible: a runtime modulator (live-modulation.ts) aimed at a field the
 * preset recomputes every frame does nothing at all, and every preset change
 * can newly create that situation. The MIDI path had warned about exactly
 * this since it shipped; the modulation path had no notation for it anywhere.
 *
 * Both are now the same question, answered by parameter-state.ts, so the two
 * regimes read as one vocabulary instead of two dialects.
 *
 * Renders nothing until audio is live and something is actually driving a
 * parameter, so users of neither feature never see it.
 */

/** Modulators are bound and unbound rarely and through a non-React API, so a
 * slow poll is both sufficient and cheaper than plumbing a subscription
 * through the runtime for a HUD that only exists while performing. */
const MODULATOR_POLL_MS = 500;

/**
 * Cap on remembered CC values. The keys come off an external event stream
 * (a device can send any binding target), and the map outlives every render,
 * so it gets a limit and an eviction path rather than an assumption that the
 * binding set stays small. Well above any real controller's channel count.
 */
const MAX_TRACKED_TARGETS = 256;

export function LiveParameterHud() {
  const { engineSnapshot } = useEngineSnapshot();
  const activeSource = engineSnapshot?.currentSource ?? '';
  const [midiTargets, setMidiTargets] = useState<string[]>(() => [
    ...webMidiService.getEnabledTargets(),
  ]);
  const [modulatedTargets, setModulatedTargets] = useState<string[]>([]);
  // CC values land in the ref as they arrive; the 100ms tick copies them
  // into state, and render reads only the copy, so React Compiler can
  // compile this component (#1540).
  const valuesRef = useRef<Map<string, number>>(new Map());
  const [values, setValues] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  const pendingTickRef = useRef<number | null>(null);

  useEffect(
    () =>
      webMidiService.onDevicesChanged(() => {
        setMidiTargets([...webMidiService.getEnabledTargets()]);
      }),
    [],
  );

  useEffect(() => {
    const read = () => {
      const next = [...new Set(listModulators().map((mod) => mod.target))];
      setModulatedTargets((current) =>
        current.length === next.length &&
        current.every((target, index) => target === next[index])
          ? current
          : next,
      );
    };
    read();
    const timer = window.setInterval(read, MODULATOR_POLL_MS);
    return () => window.clearInterval(timer);
  }, []);

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
        const tracked = valuesRef.current;
        if (!tracked.has(target) && tracked.size >= MAX_TRACKED_TARGETS) {
          // Oldest insertion first — Map preserves insertion order, and a
          // target that has not been touched since the cap was reached is
          // the least interesting one to keep.
          const oldest = tracked.keys().next().value;
          if (oldest !== undefined) tracked.delete(oldest);
        }
        tracked.set(target, normalized);
        if (pendingTickRef.current !== null) return;
        pendingTickRef.current = window.setTimeout(() => {
          pendingTickRef.current = null;
          setValues(new Map(valuesRef.current));
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

  const midiSet = new Set(midiTargets);
  const modulatedSet = new Set(modulatedTargets);
  const targets = [...new Set([...midiTargets, ...modulatedTargets])];

  if (!engineSnapshot?.audioActive || targets.length === 0) {
    return null;
  }

  return (
    <aside className="stims-shell__midi-hud" aria-label="Live parameter status">
      {targets.map((target) => {
        const state = describeParameterState({
          target,
          source: activeSource || null,
          midiBound: midiSet.has(target),
          runtimeModulated: modulatedSet.has(target),
        });
        const value = values.get(target);
        return (
          <span
            key={target}
            className="stims-shell__midi-hud-chip"
            data-driver={state.driver}
            data-overridden={state.overridden ? 'true' : 'false'}
            title={`${target} — ${state.summary}`}
          >
            <span
              className={`stims-shell__midi-hud-dot stims-shell__midi-hud-dot--${
                state.overridden ? 'shadowed' : 'live'
              }`}
            />
            <span className="stims-shell__midi-hud-label">{target}</span>
            <span className="stims-shell__midi-hud-value">
              {state.overridden
                ? parameterStateLabel(state)
                : value === undefined
                  ? parameterStateLabel(state)
                  : value.toFixed(2)}
            </span>
            {/* `title` is hover-only, and these chips are deliberately not
                focusable — they are a status readout, not controls — so a
                tooltip would reach nobody using a screen reader. This text
                carries the same detail for anyone reading the region. It is
                deliberately NOT inside a live region: the values retick on
                every incoming MIDI CC, so announcing each change made a
                swept knob talk over everything else. */}
            <span className="stims-shell__sr-only">{state.summary}</span>
          </span>
        );
      })}
    </aside>
  );
}
