import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../../css/ContextualHelp.module.css';
import { isMobileDevice } from '../utils/browser/device-detect.ts';

/**
 * Where a hint is drawn.
 *
 * `stage` is the bottom-centre toast slot, which is right for a hint about the
 * stage itself. `panel` puts the hint over the side panel it is talking about:
 * a tip about the browse grid or the code editor rendered in the stage slot
 * pointed at nothing, sitting on the opposite side of the screen from the
 * thing it described — and on the discover route, where no grid is on screen
 * at all, it pointed at nothing that existed.
 */
type HelpHintAnchor = 'stage' | 'panel';

type HelpHint = {
  id: string;
  message: string;
  autoHideMs: number;
  anchor: HelpHintAnchor;
};

type HelpHintDef = {
  id: string;
  message: string | (() => string);
  autoHideMs: number;
  anchor: HelpHintAnchor;
};

const HINTS: HelpHintDef[] = [
  {
    id: 'first-play',
    message: () =>
      isMobileDevice()
        ? 'Swipe to change the visuals — double-tap to fill the screen'
        : 'Press → for a different visual. Move the mouse for controls.',
    autoHideMs: 6000,
    anchor: 'stage',
  },
  {
    id: 'browse-open',
    message: 'Tap a card to play it',
    autoHideMs: 5000,
    anchor: 'panel',
  },
  {
    // Interaction-reactive presets were completely silent about being
    // interactive: the keys and gestures that drive them are documented in
    // the shortcuts dialog now, but nothing told you *this* visual is one of
    // the few that listens. Fires once, the first time you land on one.
    id: 'interactive-preset',
    message: () =>
      isMobileDevice()
        ? 'This visual reacts to you — drag, pinch and twist it'
        : 'This visual reacts to you — click it and drag, or press Q, R, [ and ]',
    autoHideMs: 7000,
    anchor: 'stage',
  },
  {
    id: 'editor-open',
    message:
      'This is the preset’s source code. Edits show up in the visuals live.',
    autoHideMs: 6000,
    anchor: 'panel',
  },
];

const STORAGE_KEY = 'stims:seen-hints';

function getSeenHints(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function markHintSeen(id: string) {
  try {
    const seen = getSeenHints();
    seen.add(id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
  } catch {
    /* storage unavailable */
  }
}

export function useHelpHints() {
  const [visibleHint, setVisibleHint] = useState<HelpHint | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showHint = useCallback((id: string) => {
    const seen = getSeenHints();
    if (seen.has(id)) return;

    const hint = HINTS.find((h) => h.id === id);
    if (!hint) return;

    markHintSeen(id);
    setVisibleHint({
      id: hint.id,
      autoHideMs: hint.autoHideMs,
      anchor: hint.anchor,
      message:
        typeof hint.message === 'function' ? hint.message() : hint.message,
    });

    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setVisibleHint(null);
    }, hint.autoHideMs);
  }, []);

  const dismissHint = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setVisibleHint(null);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  return { visibleHint, showHint, dismissHint };
}

export function ContextualHelp({
  hint,
  anchor = 'stage',
}: {
  hint: HelpHint | null;
  /** Which slot is rendering this instance. */
  anchor?: HelpHintAnchor;
}) {
  // One <ContextualHelp> is mounted per slot; each renders only the hints
  // addressed to it, so a hint about a panel cannot appear over the stage.
  if (!hint || hint.anchor !== anchor) return null;

  return (
    <div
      className={styles.toast}
      data-anchor={hint.anchor}
      role="status"
      aria-live="polite"
    >
      <span>{hint.message}</span>
    </div>
  );
}
