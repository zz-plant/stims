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
    // "Move the mouse for controls" was the only route this named, which is
    // a dead end for anyone driving the page from the keyboard — the one
    // audience that most needs to be told where the controls are, since the
    // dock is hidden until something asks for it. Tab reaches the same dock.
    // `?` is named here because nothing else on the stage ever mentions it,
    // and it is the one key that lists every other one.
    message: () =>
      isMobileDevice()
        ? 'Swipe to change the visuals — double-tap to fill the screen'
        : 'Press → for a different visual, Space to pause, ? for every key. Tab (or move the mouse) for the controls.',
    autoHideMs: 7000,
    anchor: 'stage',
  },
  {
    id: 'browse-open',
    message: 'Tap a card to play it',
    autoHideMs: 5000,
    anchor: 'panel',
  },
  {
    // Taught on the first drag, whatever the preset. This used to fire only
    // on presets that read the interaction signals — which is 0 of the 2,686
    // bundled — while drag, pinch and twist move the picture on every one of
    // them through the runtime's interaction response. So the hint about
    // dragging never showed, and the drag it described worked everywhere.
    id: 'interactive-preset',
    message: () =>
      isMobileDevice()
        ? 'Dragging moves the visuals. Pinch to zoom and warp, twist to rotate.'
        : 'Dragging moves the visuals. Scroll to nudge them; = and - zoom, , and . rotate.',
    autoHideMs: 7000,
    anchor: 'stage',
  },
  {
    id: 'editor-open',
    // The Esc half is not trivia: Tab indents inside the code, so it is the
    // one place in the app Tab does not walk you out of, and nothing said so.
    message:
      'This is the preset’s source code. Edits show up in the visuals live. Tab indents; Esc steps out.',
    autoHideMs: 6000,
    anchor: 'panel',
  },
  {
    // The address bar has carried the live draft in a `#code=` hash since
    // remix links shipped, and nothing said so — so the one way to hand
    // someone an unfinished preset was known only to people who had read the
    // router. Taught at the first keystroke that makes the claim true.
    id: 'editor-dirty-link',
    message:
      'Your draft is already in the address bar. Share link sends it exactly as it is here.',
    autoHideMs: 7000,
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
