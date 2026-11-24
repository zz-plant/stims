/**
 * Paced breathing (#1625): the setup sheet and the guide over the stage.
 *
 * The guide's bar fills on the inhale and drains on the exhale, driven per
 * frame from the guided breathing clock; the label changes only at the
 * turn, with no countdown and no animation on the text. While a session
 * runs the workspace hides the rest of the stage chrome, so this is the
 * only thing over the picture. Escape, a tap, or the session's end stops it.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import styles from '../../css/PacedBreathing.module.css';
import { containDialogKeydown } from '../core/modal-utils.ts';
import {
  type BreathingShape,
  getGuidedBreathing,
  guidedBreathingPhase,
  inhaleShareFor,
  subscribeGuidedBreathing,
} from '../core/services/guided-breathing.ts';
import { isMobileDevice } from '../utils/browser/device-detect.ts';
import { DialogCloseButton } from './DialogCloseButton.tsx';
import {
  useBottomOverlaySignal,
  useEscapeHandler,
} from './hooks/use-escape-handler.ts';
import { useFocusTrap } from './hooks/use-focus-trap.ts';
import {
  closeBreathingSetup,
  getBreathingSetupRequest,
  openBreathingSetup,
  readBreatheParam,
  startPacedBreathing,
  stopPacedBreathing,
  subscribeBreathingSetup,
} from './paced-breathing.ts';

const RATES = [4.5, 5, 5.5, 6, 7];
const LENGTHS: Array<{ label: string; ms: number | null }> = [
  { label: '5 min', ms: 5 * 60_000 },
  { label: '10 min', ms: 10 * 60_000 },
  { label: '20 min', ms: 20 * 60_000 },
  { label: 'Open', ms: null },
];
const SHAPES: Array<{ label: string; value: BreathingShape }> = [
  { label: 'Even', value: 'even' },
  { label: 'Longer out', value: 'longer-out' },
];

const formatRate = (rate: number) => String(rate);

function formatRemaining(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export function PacedBreathingLayer({ liveMode }: { liveMode: boolean }) {
  const setup = useSyncExternalStore(
    subscribeBreathingSetup,
    getBreathingSetupRequest,
    () => null,
  );
  const session = useSyncExternalStore(
    subscribeGuidedBreathing,
    getGuidedBreathing,
    () => null,
  );

  // `?breathe=6` opens the setup at that rate once the stage is live. A
  // link starts nothing on its own: the visitor reads the sheet and presses
  // Start.
  const linkHandledRef = useRef(false);
  useEffect(() => {
    if (!liveMode || linkHandledRef.current) return;
    linkHandledRef.current = true;
    const rate = readBreatheParam(window.location.search);
    if (rate !== null) openBreathingSetup({ rate });
  }, [liveMode]);

  // Leaving live mode ends a session rather than leaving the swell running
  // under the launch page.
  useEffect(() => {
    if (!liveMode) stopPacedBreathing();
  }, [liveMode]);

  if (session) return <BreathingGuide />;
  if (setup) return <BreathingSetup initialRate={setup.rate} />;
  return null;
}

function BreathingSetup({ initialRate }: { initialRate: number }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [rate, setRate] = useState(
    RATES.includes(initialRate) ? initialRate : 6,
  );
  const [shape, setShape] = useState<BreathingShape>('even');
  const [lengthMs, setLengthMs] = useState<number | null>(10 * 60_000);

  useFocusTrap({
    active: true,
    autoFocus: true,
    restoreFocusOnUnmount: true,
    externalContainerRef: dialogRef,
    initialFocus: 'container',
  });
  useEscapeHandler(true, closeBreathingSetup);
  useBottomOverlaySignal(true);

  const start = () => {
    closeBreathingSetup();
    startPacedBreathing({ rate, shape, lengthMs });
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard dismiss is Escape, handled above
    // biome-ignore lint/a11y/noStaticElementInteractions: click-to-dismiss scrim; the dialog role belongs on the card it wraps
    <div className="stims-shell__credits-overlay" onClick={closeBreathingSetup}>
      <div
        ref={dialogRef}
        className="stims-shell__credits-card stims-shell__credits-card--narrow"
        data-shell-dialog="true"
        role="dialog"
        aria-modal="true"
        aria-labelledby="paced-breathing-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={containDialogKeydown}
      >
        <div className="stims-shell__dialog-head">
          <h2 id="paced-breathing-title" className="stims-shell__dialog-title">
            Paced breathing
          </h2>
          <DialogCloseButton
            label="Close paced breathing"
            onClose={closeBreathingSetup}
          />
        </div>
        <p className={`stims-shell__dialog-subtitle ${styles.intro}`}>
          The picture swells as you breathe in and settles as you breathe out.
          Works without a sensor or a microphone.
        </p>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Breaths a minute</legend>
          <div className={`ctl-options ${styles.row}`}>
            {RATES.map((value) => (
              <label key={value} className="ctl-option">
                <input
                  type="radio"
                  name="breathing-rate"
                  className="ctl-option__input"
                  checked={rate === value}
                  onChange={() => setRate(value)}
                />
                <span className="ctl-option__label">{formatRate(value)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>In and out</legend>
          <div className={`ctl-options ${styles.row}`}>
            {SHAPES.map((option) => (
              <label key={option.value} className="ctl-option">
                <input
                  type="radio"
                  name="breathing-shape"
                  className="ctl-option__input"
                  checked={shape === option.value}
                  onChange={() => setShape(option.value)}
                />
                <span className="ctl-option__label">{option.label}</span>
              </label>
            ))}
          </div>
          <p className={styles.caution}>
            Stop or slow down if you feel light-headed.
          </p>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Length</legend>
          <div className={`ctl-options ${styles.row}`}>
            {LENGTHS.map((option) => (
              <label key={option.label} className="ctl-option">
                <input
                  type="radio"
                  name="breathing-length"
                  className="ctl-option__input"
                  checked={lengthMs === option.ms}
                  onChange={() => setLengthMs(option.ms)}
                />
                <span className="ctl-option__label">{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className={styles.actions}>
          <button type="button" className="cta-button" onClick={start}>
            Start
          </button>
          <button
            type="button"
            className="cta-button ghost"
            onClick={closeBreathingSetup}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function BreathingGuide() {
  const barRef = useRef<HTMLSpanElement | null>(null);
  const [inhale, setInhale] = useState(true);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const session = getGuidedBreathing();
  const touch = isMobileDevice();

  useEscapeHandler(true, stopPacedBreathing);

  useEffect(() => {
    let frame = 0;
    let lastInhale: boolean | null = null;
    let lastSecond = -1;
    const step = () => {
      const state = guidedBreathingPhase(performance.now());
      const active = getGuidedBreathing();
      if (!state || !active) return;
      const share = inhaleShareFor(active.shape);
      const fill = state.inhale
        ? state.phase / share
        : 1 - (state.phase - share) / (1 - share);
      if (barRef.current) {
        barRef.current.style.transform = `scaleX(${fill.toFixed(4)})`;
      }
      // Text changes at the turn only, and the clock once a second.
      if (state.inhale !== lastInhale) {
        lastInhale = state.inhale;
        setInhale(state.inhale);
      }
      const second =
        state.remainingMs === null ? -1 : Math.ceil(state.remainingMs / 1000);
      if (second !== lastSecond) {
        lastSecond = second;
        setRemainingMs(state.remainingMs);
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!session) return null;

  const meta = [
    `${formatRate(session.breathsPerMinute)} a minute`,
    remainingMs === null ? null : `${formatRemaining(remainingMs)} left`,
    touch ? 'Tap to end' : 'Esc to end',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={styles.guideLayer}>
      {/* The whole stage ends the session on a tap, as the spec's phone
          layout asks; the button is what a keyboard or reader reaches. */}
      <button
        type="button"
        className={styles.endSurface}
        aria-label="End paced breathing"
        onClick={stopPacedBreathing}
      />
      <div className={styles.guide} aria-live="polite">
        <p className={styles.label}>{inhale ? 'Breathe in' : 'Breathe out'}</p>
        <span className={styles.track} aria-hidden="true">
          <span ref={barRef} className={styles.bar} />
        </span>
        <p className={styles.meta}>{meta}</p>
      </div>
    </div>
  );
}
