import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../../css/ContextualHelp.module.css';

type HelpHint = {
  id: string;
  message: string;
  autoHideMs: number;
};

const HINTS: HelpHint[] = [
  {
    id: 'first-play',
    message: 'Space or tap to switch presets',
    autoHideMs: 6000,
  },
  {
    id: 'first-shuffle',
    message: 'Try Browse to find a different visual vibe',
    autoHideMs: 5000,
  },
  {
    id: 'quiet-hint',
    message: 'Not hearing much? Switch to demo audio for guaranteed motion',
    autoHideMs: 8000,
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
    setVisibleHint(hint);

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
  onDismiss,
}: {
  hint: HelpHint | null;
  onDismiss: () => void;
}) {
  const [exiting, setExiting] = useState(false);

  const handleDismiss = useCallback(() => {
    setExiting(true);
    setTimeout(onDismiss, 200);
  }, [onDismiss]);

  if (!hint) return null;

  return (
    <div
      className={styles.toast}
      data-exiting={String(exiting)}
      role="status"
      aria-live="polite"
    >
      <span>{hint.message}</span>
      <button
        type="button"
        className={styles.closeButton}
        onClick={handleDismiss}
        aria-label="Dismiss hint"
      >
        ×
      </button>
    </div>
  );
}
