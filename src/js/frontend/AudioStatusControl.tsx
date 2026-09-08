/**
 * The stage's answer to "is this thing on?".
 *
 * The dock has always carried an energy bar, but it was `aria-hidden`
 * decoration: it moved with the music and said nothing about what was
 * playing or why it had stopped moving. This is the same meter promoted
 * into a control that names its own state and, when something is wrong,
 * puts the fix one click away instead of three panels deep.
 *
 * It is deliberately not another copy of the audio setup panel. Sources that
 * need an argument — a file to pick, a URL to paste — stay in that panel;
 * what lives here is the mid-set subset that starts from a single click,
 * matching the stage menu's own audio row, plus a door to the full panel.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../../css/AudioStatusControl.module.css';
import {
  type AudioSignalState,
  describeAudioSignal,
  useAudioSignalState,
} from './audio-signal-state.ts';
import {
  getAudioEnergy,
  subscribeAudioEnergy,
} from './engine-audio-energy-store.ts';
import { pulseHaptic } from './haptics.ts';
import { useListKeyboardNav } from './hooks/use-list-keyboard-nav.ts';
import { UiIcon } from './UiIcon.tsx';
import { startAudioSource, togglePanel } from './workspace-actions.ts';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';

/**
 * Sources that start from one click. Kept in step with the stage menu's own
 * audio row — the same three verbs, because a control that offered a
 * different set depending on which surface you reached it from would be
 * teaching two vocabularies for one job.
 */
const QUICK_SOURCES = [
  { source: 'demo' as const, label: 'Demo track' },
  { source: 'microphone' as const, label: 'Microphone' },
  { source: 'tab' as const, label: 'This tab' },
] satisfies ReadonlyArray<{
  source: 'demo' | 'microphone' | 'tab';
  label: string;
}>;

const SOURCE_NAMES: Record<string, string> = {
  demo: 'Demo track',
  microphone: 'Microphone',
  tab: 'Tab audio',
  file: 'Audio file',
  youtube: 'YouTube',
};

/** Short enough for the dock at 375px, where the title already truncates. */
const SOURCE_SHORT: Record<string, string> = {
  demo: 'Demo',
  microphone: 'Mic',
  tab: 'Tab',
  file: 'File',
  youtube: 'YT',
};

function iconForState(state: AudioSignalState) {
  if (state === 'off') return 'volume-off' as const;
  if (state === 'silent') return 'warning' as const;
  return 'pulse' as const;
}

/**
 * What to do next, in the words of the state you are actually in. The silent
 * case is the one that earns this control: it is the only state whose fix
 * depends on which source is running.
 */
function nextStepFor(
  state: AudioSignalState,
  source: string | null,
): string | null {
  if (state !== 'silent') return null;
  if (source === 'microphone') {
    return 'Check the input device and that your mic is not muted.';
  }
  if (source === 'tab') {
    return 'Check the shared tab is playing, and that you ticked "Share tab audio".';
  }
  if (source === 'youtube' || source === 'file') {
    return 'Check playback is running and the volume is up.';
  }
  return 'Try another source, or check your system volume.';
}

export function AudioStatusControl() {
  const { ui, engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const audioSource = engineSnapshot?.audioSource ?? null;
  const state = useAudioSignalState(Boolean(audioSource));
  const sourceName = audioSource ? (SOURCE_NAMES[audioSource] ?? null) : null;
  const { label, detail } = describeAudioSignal(state, sourceName);
  const nextStep = nextStepFor(state, audioSource);

  const [open, setOpen] = useState(false);
  const meterRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Written straight to a custom property rather than through state: this
  // updates at audio rate, and a re-render per frame would cost the whole
  // dock for one bar's height.
  useEffect(() => {
    const update = () => {
      const energy = Math.min(1, Math.max(0, getAudioEnergy()));
      meterRef.current?.style.setProperty('--meter', String(energy));
    };
    update();
    return subscribeAudioEnergy(update);
  }, []);

  useListKeyboardNav(popoverRef, {
    itemSelector: '[role^="menuitem"]',
    orientation: 'vertical',
    deps: [open],
  });

  useEffect(() => {
    if (!open) return;
    popoverRef.current
      ?.querySelector<HTMLElement>('[role^="menuitem"]')
      ?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        (popoverRef.current?.contains(event.target) ||
          buttonRef.current?.contains(event.target))
      ) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const run = useCallback((fn: () => void) => {
    pulseHaptic(10);
    setOpen(false);
    fn();
    buttonRef.current?.focus();
  }, []);

  return (
    <div className={styles.wrap}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.trigger}
        data-signal={state}
        data-action="audio-status"
        aria-expanded={open}
        aria-haspopup="menu"
        // The visible label is a word or two; the accessible name is the
        // whole sentence, because a screen reader user gets no help from the
        // meter animation that carries half the meaning for everyone else.
        aria-label={`Audio status. ${detail}${nextStep ? ` ${nextStep}` : ''}`}
        title={detail}
        onClick={() => {
          pulseHaptic(10);
          setOpen((current) => !current);
        }}
      >
        <span ref={meterRef} className={styles.meter} aria-hidden="true">
          <span className={styles.meterFill} />
        </span>
        <UiIcon
          name={iconForState(state)}
          className="stims-icon-slot stims-icon-slot--sm"
        />
        <span className={styles.label}>
          {state === 'live' && audioSource
            ? (SOURCE_SHORT[audioSource] ?? label)
            : label}
        </span>
      </button>

      {open ? (
        <div
          ref={popoverRef}
          className={styles.popover}
          role="menu"
          aria-label="Audio status and sources"
        >
          <p className={styles.detail}>
            {detail}
            {nextStep ? (
              <span className={styles.nextStep}>{nextStep}</span>
            ) : null}
          </p>

          {/* biome-ignore lint/a11y/useSemanticElements: role=group is the ARIA menu pattern for menuitemradio sets; fieldset carries form semantics a menu must not have */}
          <div className={styles.group} role="group" aria-label="Audio source">
            {QUICK_SOURCES.map((option) => (
              <button
                key={option.source}
                type="button"
                role="menuitemradio"
                aria-checked={audioSource === option.source}
                className={styles.item}
                data-action={`audio-${option.source}`}
                data-active={String(audioSource === option.source)}
                onClick={() =>
                  run(() => startAudioSource(engine, option.source))
                }
              >
                {option.label}
              </button>
            ))}
          </div>

          {audioSource ? (
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              data-action="stop-audio"
              onClick={() => run(() => engine.handleAudioStop())}
            >
              Stop audio
            </button>
          ) : null}

          <button
            type="button"
            role="menuitem"
            className={styles.item}
            data-action="open-audio-setup"
            onClick={() =>
              run(() =>
                togglePanel(
                  {
                    updatePanel: ui.updatePanel,
                    routePanel: () => ui.routeState.panel ?? null,
                  },
                  'settings',
                ),
              )
            }
          >
            Audio setup…
          </button>
        </div>
      ) : null}
    </div>
  );
}
