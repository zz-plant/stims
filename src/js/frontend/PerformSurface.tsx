import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import styles from '../../css/PerformSurface.module.css';
import { getBrowserStorage } from '../core/state/browser-storage.ts';
import { hadSessionBeforeBoot } from '../core/state/last-session-store.ts';
import { readMilkdropField } from '../milkdrop/formatter.ts';
import { listModulators } from './live-modulation.ts';
import {
  describeParameterState,
  parameterStateLabel,
} from './parameter-state.ts';
import {
  describePinnableField,
  getPinnedTargets,
  PINNABLE_FIELDS,
  pinTarget,
  subscribeToPerformPicker,
  subscribeToPinnedTargets,
  unpinTarget,
} from './perform-pins.ts';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';

/**
 * The controls you chose, on the stage, while everything else stays in
 * Settings.
 *
 * Every parameter here carries its driver state from parameter-state.ts, so a
 * fader the preset overwrites every frame says so instead of moving and doing
 * nothing — which is the single most confusing thing a control on this
 * surface can do, and the reason the state vocabulary had to exist first.
 *
 * Empty by default: an unpinned visitor sees nothing — except a one-time
 * returning-visitor hint (see below) that introduces the surface.
 */

/** The one-time empty-state hint shows once, then stays gone once dismissed. */
const PERFORM_HINT_DISMISSED_KEY = 'stims:perform-empty-hint-dismissed';

export function PerformSurface() {
  const { engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  // Subscribed, not copied: the agent bridge can pin and unpin too, and the
  // panel has to reflect that rather than hold its own divergent list.
  const pinned = useSyncExternalStore(
    subscribeToPinnedTargets,
    getPinnedTargets,
    getPinnedTargets,
  );
  const [picking, setPicking] = useState(false);
  const [values, setValues] = useState<Record<string, number>>({});
  const [modulated, setModulated] = useState<string[]>([]);
  const [hintDismissed, setHintDismissed] = useState(() => {
    try {
      return getBrowserStorage()?.getItem(PERFORM_HINT_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  const activeSource = engineSnapshot?.currentSource ?? '';
  const activePresetId = engineSnapshot?.activePresetId ?? null;

  // With nothing pinned this panel is absent, so the dock and the palette
  // are the only way to reach the picker the first time.
  useEffect(() => subscribeToPerformPicker(() => setPicking(true)), []);

  // Modulators are bound through a non-React API; the same slow poll the HUD
  // uses is enough for a set that changes only when someone binds one.
  useEffect(() => {
    const read = () => {
      const next = [...new Set(listModulators().map((mod) => mod.target))];
      setModulated((current) =>
        current.length === next.length &&
        current.every((target, index) => target === next[index])
          ? current
          : next,
      );
    };
    read();
    const timer = window.setInterval(read, 500);
    return () => window.clearInterval(timer);
  }, []);

  // Re-seed each fader from the incoming preset's own literal on every preset
  // change. Without this the faders keep the outgoing preset's positions and
  // silently misreport where the new preset actually sits.
  const seededForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeSource || seededForRef.current === activePresetId) return;
    seededForRef.current = activePresetId;
    const seeded: Record<string, number> = {};
    for (const target of pinned) {
      const field = describePinnableField(target);
      if (!field) continue;
      const literal = readMilkdropField(activeSource, target);
      seeded[target] = literal ?? (field.min + field.max) / 2;
    }
    setValues(seeded);
  }, [activeSource, activePresetId, pinned]);

  const move = useCallback(
    (target: string, value: number) => {
      setValues((current) => ({ ...current, [target]: value }));
      engine.updateFieldLive(target, value);
    },
    [engine],
  );

  const unpin = useCallback((target: string) => {
    unpinTarget(target);
  }, []);

  const pin = useCallback((target: string) => {
    pinTarget(target);
    setPicking(false);
  }, []);

  if (pinned.length === 0 && !picking) {
    // A performer with no pinned controls sees this surface as a hint, not as
    // nothing — there is nothing on it yet, so it tells them what it is for
    // and how to open it. Dismissed once, it stays hidden until they actually
    // pin something.
    if (hintDismissed) return null;
    // Not on the very first visit, and not on phones — same reasoning as the
    // cue deck's hint: a first session belongs to the visuals, and on a
    // narrow screen this card ate half the stage.
    if (!hadSessionBeforeBoot()) return null;
    if (window.matchMedia('(max-width: 719px)').matches) return null;
    return (
      <aside className={styles.surface} aria-label="Performance controls">
        <div className={styles.header}>
          <span className={styles.label}>Perform</span>
          <button
            type="button"
            className={styles.pick}
            onClick={() => setPicking(true)}
            data-action="perform-pin"
          >
            Pin…
          </button>
        </div>
        <p className={styles.empty}>
          Put your go-to parameters here as sliders you can drive live on the
          stage. Nothing pinned yet — pick one to begin.
          <button
            type="button"
            className={styles.dismiss}
            onClick={() => {
              setHintDismissed(true);
              try {
                getBrowserStorage()?.setItem(PERFORM_HINT_DISMISSED_KEY, '1');
              } catch {
                console.debug('Unable to persist perform hint dismissal');
              }
            }}
            aria-label="Dismiss perform surface hint"
          >
            Dismiss
          </button>
        </p>
      </aside>
    );
  }

  return (
    <aside className={styles.surface} aria-label="Performance controls">
      <div className={styles.header}>
        <span className={styles.label}>Perform</span>
        <button
          type="button"
          className={styles.pick}
          onClick={() => setPicking((open) => !open)}
          aria-expanded={picking}
          data-action="perform-pin"
        >
          {picking ? 'Done' : 'Pin…'}
        </button>
      </div>

      {picking ? (
        <ul className={styles.picker}>
          {PINNABLE_FIELDS.filter(
            (field) => !pinned.includes(field.target),
          ).map((field) => (
            <li key={field.target}>
              <button type="button" onClick={() => pin(field.target)}>
                {field.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {pinned.map((target) => {
        const field = describePinnableField(target);
        if (!field) return null;
        const state = describeParameterState({
          target,
          source: activeSource || null,
          runtimeModulated: modulated.includes(target),
          // The fader on this row is itself a control, so a field the preset
          // recomputes every frame must report as overridden rather than as
          // ordinary preset behaviour.
          userControlled: true,
        });
        const value = values[target] ?? (field.min + field.max) / 2;
        return (
          <div
            key={target}
            className={styles.control}
            data-driver={state.driver}
            data-overridden={state.overridden ? 'true' : 'false'}
          >
            <div className={styles.controlHeader}>
              <span className={styles.controlLabel}>{field.label}</span>
              {/* `title` is hover-only, so the explanation was invisible to
                  keyboard and screen-reader users — who need it most, since
                  they cannot see the fader failing to move anything. The
                  summary is wired to the slider itself via aria-describedby,
                  which is where it gets announced. */}
              <span
                className={styles.state}
                id={`perform-state-${target}`}
                title={state.summary}
              >
                {parameterStateLabel(state)}
              </span>
              <button
                type="button"
                className={styles.unpin}
                onClick={() => unpin(target)}
                aria-label={`Unpin ${field.label}`}
              >
                ×
              </button>
            </div>
            <input
              type="range"
              min={field.min}
              max={field.max}
              step={field.step}
              value={value}
              onChange={(event) => move(target, Number(event.target.value))}
              aria-label={field.label}
              // Both the state chip and, when present, the "has no effect"
              // warning — otherwise a screen reader announces the word
              // "overridden" with no explanation of what to do about it.
              aria-describedby={
                state.overridden
                  ? `perform-state-${target} perform-warning-${target}`
                  : `perform-state-${target}`
              }
              data-field={target}
            />
            {/* The one thing a control on a performance surface must never do
                is move without effect. Say so rather than let the performer
                discover it mid-set. */}
            {state.overridden ? (
              <p className={styles.warning} id={`perform-warning-${target}`}>
                This preset recomputes {target} every frame — the fader has no
                effect here.
              </p>
            ) : null}
          </div>
        );
      })}

      {pinned.length === 0 ? (
        <p className={styles.empty}>
          Nothing pinned yet. Pick a parameter to put it on the stage.
        </p>
      ) : null}
    </aside>
  );
}
