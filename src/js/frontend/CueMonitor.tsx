import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../../css/CueMonitor.module.css';
import { getBrowserStorage } from '../core/state/browser-storage.ts';
import { splitPresetDisplay } from '../milkdrop/preset-credit.ts';
import type { PresetCatalogEntry } from './contracts.ts';
import { useLivePresetTile } from './hooks/use-live-preset-tile.ts';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';

/**
 * The live tile itself, split out so the pool hook is only ever called with a
 * real entry — the queue head changes identity, and a conditional hook or a
 * placeholder entry would either break the rules of hooks or acquire a pool
 * handle for a preset that does not exist.
 */
/** How long the panel waits for an armed fade to actually start before
 * giving up on it. Generous enough for a cold compile, short enough that a
 * switch that never lands does not strand the panel. */
const ARM_TIMEOUT_MS = 6000;

/**
 * The empty-state affordance shows once and stays gone once dismissed, so the
 * cue deck surfaces its existence to a first-time visitor without permanently
 * squatting on the stage the way a pinned (non-empty) deck must.
 */
const CUE_HINT_DISMISSED_KEY = 'stims:cue-empty-hint-dismissed';

function CueScreen({ entry }: { entry: PresetCatalogEntry }) {
  // `audition: true` opts this one tile into the live pool without the global
  // ?liveTiles flag. The cue deck is the tile that most earns an engine, and
  // the pool's capacity provider still sheds it if the stage starts to
  // struggle — the thing the user is watching keeps priority.
  const { enabled, hostRef } = useLivePresetTile(entry, { audition: true });

  return (
    <div className={styles.screen} ref={hostRef}>
      {enabled ? null : <span className={styles.placeholder}>No preview</span>}
    </div>
  );
}

/**
 * The deck you can see but the audience can't.
 *
 * Switching preset is a jump to something you have not seen: the choice is
 * made blind, and the only way to find out what you picked is to put it on
 * the stage in front of everyone. Every DJ mixer solves this with a cue
 * channel, and the machinery for one already existed here — the live tile
 * pool runs real MilkDrop pipelines at micro-resolution, and the preset queue
 * has been persisted since it was written while being rendered nowhere.
 *
 * So this is a cue channel, not a queue manager: the next preset *running*,
 * with one control to take it and one to pass. Reordering belongs in the
 * browse panel, where there is room for it; clearing sits on the "n more
 * queued" line here, because the browse panel has no queue view yet and the
 * palette was otherwise the only route to it.
 *
 * Renders nothing when the queue is empty, so it stays invisible to everyone
 * who never builds one.
 */
export function CueMonitor() {
  const { ui, engine } = useWorkspace();
  const [fader, setFader] = useState(0);
  // The engine settles the fade on its own once the fader reaches the end (or
  // when the switch is abandoned), so the control has to follow the engine
  // rather than assume it still owns a live crossfade.
  const fadingRef = useRef(false);
  const [fading, setFading] = useState(false);
  // Arming and fading are not the same instant. `startManualCrossfade` only
  // marks the *next* switch; the engine does not enter its manual phase until
  // that preset has been fetched, compiled and applied. Without tracking the
  // gap, taking the last queued preset emptied the queue and unmounted this
  // panel — taking the fader with it — before the fade ever began.
  const [arming, setArming] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(() => {
    try {
      return getBrowserStorage()?.getItem(CUE_HINT_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (!arming) return;
    // Bounded: if the switch never lands (an already-active preset, a failed
    // load), the panel must not sit armed forever waiting for a fade that is
    // not coming.
    const timeout = window.setTimeout(() => {
      setArming(false);
      // The engine reports its own reason (a workload-gated fade says so);
      // this covers the rest — a load that failed, or a switch that never
      // arrived — so the fader's absence is never left unexplained.
      ui.setStatusMessage('The crossfade did not start.');
    }, ARM_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [arming, ui]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const live = engine.getCrossfade() !== null;
      if (live !== fadingRef.current) {
        fadingRef.current = live;
        setFading(live);
        if (live) setArming(false);
      }
    }, 120);
    return () => window.clearInterval(timer);
  }, [engine]);
  const { engineSnapshot } = useEngineSnapshot();
  const queue = ui.presetQueue;
  const next = queue.entries[0] ?? null;
  const activePresetId = engineSnapshot?.activePresetId ?? null;

  const take = useCallback(() => {
    const presetId = queue.popNext();
    if (!presetId) return;
    // Same route-first path the browse grid uses, so the engine load, the URL
    // and the promote transition all behave as they do everywhere else.
    ui.setRouteState((current) => ({ ...current, presetId }));
  }, [queue, ui]);

  // Ride the fade by hand instead of handing it to a timer. Arming has to
  // happen before the switch is applied, because that is the moment the
  // outgoing frame is captured and the cover starts.
  const startFade = useCallback(() => {
    const presetId = queue.entries[0]?.id;
    if (!presetId) return;
    if (presetId === activePresetId) {
      // The route push is a no-op for the preset already on stage, so the
      // armed fade would never fire. Say so instead of consuming the queue
      // entry and appearing to do nothing.
      ui.setStatusMessage('That preset is already on the stage.');
      return;
    }
    queue.popNext();
    engine.startManualCrossfade();
    setFader(0);
    setArming(true);
    ui.setRouteState((current) => ({ ...current, presetId }));
  }, [activePresetId, engine, queue, ui]);

  const moveFader = useCallback(
    (position: number) => {
      setFader(position);
      engine.setCrossfade(position);
    },
    [engine],
  );

  const skip = useCallback(() => {
    if (next) queue.remove(next.id);
  }, [next, queue]);

  // Starting a fade pops the entry, so taking the last queued preset would
  // otherwise unmount this panel — and the fader with it — halfway through
  // the gesture. An in-flight fade keeps the panel alive on its own.
  if (!next && !fading && !arming) {
    // An armed queue is the only thing that makes this deck visible, so an
    // empty queue renders nothing — except the one-time hint below, whose job
    // is to tell a first-time visitor the deck exists at all. Once dismissed
    // (or once the user actually queues something) it stays gone.
    if (hintDismissed) return null;
    return (
      <aside className={styles.cue} aria-label="Cue monitor">
        <div className={styles.header}>
          <span className={styles.label}>Cue deck</span>
          <button
            type="button"
            className={styles.dismiss}
            onClick={() => {
              setHintDismissed(true);
              try {
                getBrowserStorage()?.setItem(CUE_HINT_DISMISSED_KEY, '1');
              } catch {
                console.debug('Unable to persist cue hint dismissal');
              }
            }}
            aria-label="Dismiss cue deck hint"
          >
            ×
          </button>
        </div>
        <p className={styles.emptyHint}>
          Queue presets to preview the next one here before it hits the stage.
        </p>
      </aside>
    );
  }

  const { title, byline } = next
    ? splitPresetDisplay(next.title || next.id)
    : { title: '', byline: null };
  const remaining = Math.max(0, queue.entries.length - 1);
  // Already adjudicated upstream: null means "no trustworthy tempo", so
  // there is no confidence threshold to re-apply here.
  const tempo = engineSnapshot?.tempoBpm ?? null;

  return (
    <aside className={styles.cue} aria-label="Cue monitor">
      <div className={styles.header}>
        <span className={styles.label}>
          {fading ? 'Fading' : arming ? 'Cueing' : 'Next'}
        </span>
        {/* The tempo readout lives here rather than on the transport: this is
            the surface you are looking at while deciding when to take. */}
        {tempo !== null ? (
          <span className={styles.tempo}>{tempo} BPM</span>
        ) : null}
      </div>
      {next ? <CueScreen key={next.id} entry={next} /> : null}
      {next ? (
        <div className={styles.identity}>
          <span className={styles.title}>{title}</span>
          {byline ? <span className={styles.author}>{byline}</span> : null}
        </div>
      ) : null}
      {next ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.take}
            onClick={take}
            data-action="queue-take"
          >
            Take
          </button>
          <button
            type="button"
            className={styles.skip}
            onClick={skip}
            data-action="queue-skip"
          >
            Skip
          </button>
        </div>
      ) : null}
      {fading ? (
        <label className={styles.fader}>
          <span className={styles.faderLabel}>Crossfade</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={fader}
            onChange={(event) => moveFader(Number(event.target.value))}
            aria-label="Crossfade to the incoming preset"
            data-action="crossfade"
          />
        </label>
      ) : next ? (
        <button
          type="button"
          className={styles.skip}
          onClick={startFade}
          data-action="queue-fade"
        >
          Fade by hand
        </button>
      ) : null}
      {remaining > 0 ? (
        <p className={styles.remaining}>
          {remaining} more queued
          {/* Clearing was a palette-only action with no button anywhere,
              because the docblock above defers it to a browse-panel queue
              view that was never built. Until that exists, the count is the
              only place the rest of the queue is even mentioned, so the
              control belongs beside it. */}
          <button
            type="button"
            className={styles.clear}
            onClick={queue.clear}
            data-action="queue-clear"
          >
            Clear
          </button>
        </p>
      ) : null}
    </aside>
  );
}
