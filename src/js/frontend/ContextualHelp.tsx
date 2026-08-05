import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../../css/ContextualHelp.module.css';
import { isMobileDevice } from '../utils/browser/device-detect.ts';

type HelpHint = {
  id: string;
  message: string;
  autoHideMs: number;
};

type HelpHintDef = {
  id: string;
  message: string | (() => string);
  autoHideMs: number;
};

const HINTS: HelpHintDef[] = [
  {
    id: 'first-play',
    message: () =>
      isMobileDevice()
        ? 'Swipe for presets, long-press to favorite, double-tap to fill screen'
        : 'ArrowRight to switch presets, E to edit shaders',
    autoHideMs: 6000,
  },
  {
    id: 'browse-open',
    message: 'Tap a card to play',
    autoHideMs: 5000,
  },
  {
    id: 'editor-open',
    message: 'Edit .milk code directly — changes apply in real time',
    autoHideMs: 6000,
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

export function ContextualHelp({ hint }: { hint: HelpHint | null }) {
  if (!hint) return null;

  return (
    <div className={styles.toast} role="status" aria-live="polite">
      <span>{hint.message}</span>
    </div>
  );
}
