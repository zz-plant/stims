import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import styles from '../../css/SidePanel.module.css';
import {
  buildAudioProfile,
  searchByAudioProfile,
} from '../core/services/audio-matcher.ts';
import { searchByFrame } from '../core/services/visual-embedding.ts';
import type { PresetCatalogEntry } from './contracts.ts';
import {
  getAudioEnergy,
  subscribeAudioEnergy,
} from './engine-audio-energy-store.ts';
import { useEngineSnapshot } from './engine-context.tsx';
import { useFocusTrap } from './hooks/use-focus-trap.ts';
import { PresetArtwork } from './PresetArtwork.tsx';
import { UiIcon } from './UiIcon.tsx';
import { useWorkspace } from './workspace-context.tsx';
import { resolveAuthorUrl } from './workspace-helpers.ts';

const isMobileSheet = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(max-width: 767px)').matches;

type SidePanelProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  onOpen?: () => void;
};

export function SidePanel({
  open,
  onClose,
  title,
  children,
  onOpen,
}: SidePanelProps) {
  const [exiting, setExiting] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const isActive = open && !exiting;
  const panelRef = useFocusTrap<HTMLDivElement>({
    active: isActive,
    autoFocus: true,
    restoreFocusOnUnmount: true,
  });

  const startClose = useCallback(() => {
    if (exiting || closeTimerRef.current) return;
    setExiting(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, 200);
  }, [exiting, onClose]);

  // Swipe-down-to-close on the mobile bottom sheet. The sheet covers the
  // whole viewport there, so the backdrop is unreachable and the X sits in
  // the hardest one-handed spot (top corner).
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    lastY: number;
    lastT: number;
    velocity: number;
  } | null>(null);

  const handleDragStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isMobileSheet() || exiting) return;
      if ((e.target as HTMLElement).closest('button')) return;
      dragRef.current = {
        pointerId: e.pointerId,
        startY: e.clientY,
        lastY: e.clientY,
        lastT: e.timeStamp,
        velocity: 0,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // pointer already released (or synthetic) — drag still tracks via
        // the header's own pointer events
      }
    },
    [exiting],
  );

  const handleDragMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const panel = panelRef.current;
      if (!drag || drag.pointerId !== e.pointerId || !panel) return;
      const dy = Math.max(0, e.clientY - drag.startY);
      const dt = e.timeStamp - drag.lastT;
      if (dt > 0) {
        drag.velocity = (e.clientY - drag.lastY) / dt;
      }
      drag.lastY = e.clientY;
      drag.lastT = e.timeStamp;
      panel.style.transition = 'none';
      panel.style.transform = `translateY(${dy}px)`;
    },
    [panelRef],
  );

  const handleDragEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const panel = panelRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;
      if (!panel) return;
      const dy = Math.max(0, e.clientY - drag.startY);
      const shouldClose = dy > 96 || (dy > 24 && drag.velocity > 0.5);
      panel.style.transition = 'transform 0.2s ease';
      if (shouldClose) {
        // let the transition finish the gesture; the data-exiting keyframe
        // would snap the sheet back to translateY(0) first
        panel.style.animation = 'none';
        panel.style.transform = 'translateY(100%)';
        if (closeTimerRef.current) return;
        setExiting(true);
        closeTimerRef.current = window.setTimeout(() => {
          closeTimerRef.current = null;
          onClose();
        }, 200);
      } else {
        panel.style.transform = '';
      }
    },
    [panelRef, onClose],
  );

  useEffect(
    () => () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (open) {
      setExiting(false);
      if (onOpen) requestAnimationFrame(onOpen);
    }
  }, [open, onOpen]);

  useEffect(() => {
    if (!open || exiting) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        startClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, exiting, startClose]);

  if (!open && !exiting) return null;

  return (
    <>
      <div
        className={styles.backdrop}
        data-exiting={String(exiting)}
        onClick={startClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className={styles.panel}
        data-exiting={String(exiting)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-shell-dialog="true"
        tabIndex={-1}
      >
        <div
          className={styles.header}
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        >
          <div className={styles.grabber} aria-hidden="true" />
          <h2 className={styles.title}>{title}</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={startClose}
            aria-label="Close"
          >
            <UiIcon
              name="close"
              className="stims-icon-slot stims-icon-slot--sm"
            />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </>
  );
}

export function RefinePanel() {
  const [instruction, setInstruction] = useState('');
  const [state, setState] = useState<'idle' | 'refining' | 'explaining'>(
    'idle',
  );
  const [response, setResponse] = useState<string | null>(null);
  const { engine, ui } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const currentSource = engineSnapshot?.currentSource ?? '';

  const handleRefine = useCallback(async () => {
    if (!instruction.trim()) return;
    setState('refining');
    ui.setStatusMessage('Refining preset…');
    try {
      const res = await fetch('/api/refine-preset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentSource,
          instruction: instruction.trim(),
        }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      if (data.milkSource) {
        await engine.updateEditorSource(data.milkSource);
        setResponse(`Refined: ${data.title || 'New Preset'}`);
      } else {
        throw new Error('No source returned');
      }
    } catch (err) {
      const error = err as Error;
      setResponse(`Error: ${error.message}`);
    } finally {
      setState('idle');
      ui.setStatusMessage(null);
    }
  }, [currentSource, engine, instruction, ui]);

  const handleExplain = useCallback(async () => {
    if (!instruction.trim()) return;
    setState('explaining');
    ui.setStatusMessage('Analyzing preset…');
    try {
      const res = await fetch('/api/refine-preset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentSource,
          instruction: 'explain this preset',
        }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      setResponse(
        data.explanation || data.message || 'No explanation available.',
      );
    } catch (err) {
      const error = err as Error;
      setResponse(`Error: ${error.message}`);
    } finally {
      setState('idle');
      ui.setStatusMessage(null);
    }
  }, [currentSource, instruction, ui]);

  return (
    <div className="stims-shell__refine-panel">
      <div className="stims-shell__refine-input">
        <label htmlFor="refine-instruction" className="stims-shell__sr-only">
          Describe how to change the preset
        </label>
        <textarea
          id="refine-instruction"
          className="stims-shell__refine-textarea"
          placeholder="e.g., make it more blue, add slow rotation, increase bass reactivity"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          disabled={state !== 'idle'}
        />
      </div>
      <div className="stims-shell__refine-actions">
        <button
          type="button"
          className="stims-shell__refine-btn"
          onClick={handleRefine}
          disabled={state !== 'idle' || !instruction.trim()}
        >
          {state === 'refining' ? 'Refining…' : 'Refine'}
        </button>
        <button
          type="button"
          className="stims-shell__refine-btn stims-shell__refine-btn--secondary"
          onClick={handleExplain}
          disabled={state !== 'idle' || !instruction.trim()}
        >
          {state === 'explaining' ? 'Explaining…' : 'Explain'}
        </button>
      </div>
      {response && (
        <div
          className="stims-shell__refine-response"
          role="status"
          aria-live="polite"
        >
          {response}
        </div>
      )}
    </div>
  );
}

export function AudioMatchPanel({ onClose }: { onClose: () => void }) {
  const [matches, setMatches] = useState<Array<{
    presetId: string;
    score: number;
  }> | null>(null);
  const [loading, setLoading] = useState(false);
  const { engine } = useWorkspace();
  const [audioEnergy, setEnergy] = useState(getAudioEnergy);

  useEffect(() => {
    return subscribeAudioEnergy(() => setEnergy(getAudioEnergy()));
  }, []);

  const handleMatch = useCallback(async () => {
    if (!audioEnergy || loading) return;
    setLoading(true);
    setMatches(null);
    try {
      const profile = buildAudioProfile({ audioEnergy });
      const results = await searchByAudioProfile(profile);
      setMatches(results.slice(0, 5));
    } catch (error) {
      console.error('Audio match failed:', error);
    } finally {
      setLoading(false);
    }
  }, [audioEnergy, loading]);

  useEffect(() => {
    if (audioEnergy > 0.02) {
      handleMatch();
    }
  }, [handleMatch, audioEnergy]);

  return (
    <div className="stims-shell__audiomatch-panel">
      <div className="stims-shell__audiomatch-header">
        <UiIcon
          name="music"
          className="stims-shell__audiomatch-icon"
          aria-hidden="true"
        />
        <h3>Match my music</h3>
        <p className="stims-shell__audiomatch-desc">
          Finding presets that fit the current audio energy…
        </p>
      </div>
      {loading ? (
        <div className="stims-shell__audiomatch-loading">Analyzing audio…</div>
      ) : matches ? (
        <ul className="stims-shell__audiomatch-results">
          {matches.length === 0 ? (
            <li className="stims-shell__audiomatch-empty">No matches found</li>
          ) : (
            matches.map((match, i) => (
              <li key={match.presetId} className="stims-shell__audiomatch-item">
                <button
                  type="button"
                  className="stims-shell__audiomatch-btn"
                  onClick={() => {
                    engine.handlePlayPreset(match.presetId);
                    onClose();
                  }}
                >
                  <span className="stims-shell__audiomatch-rank">{i + 1}</span>
                  <span className="stims-shell__audiomatch-id">
                    {match.presetId}
                  </span>
                  <span className="stims-shell__audiomatch-score">
                    {(match.score * 100).toFixed(0)}% match
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : (
        <button
          type="button"
          className="stims-shell__audiomatch-refresh"
          onClick={handleMatch}
          disabled={loading || audioEnergy < 0.02}
        >
          <UiIcon
            name="refresh"
            className="stims-icon-slot stims-icon-slot--sm"
            aria-hidden="true"
          />
          Analyze audio
        </button>
      )}
    </div>
  );
}

export function VisualSearchPanel({ onClose }: { onClose: () => void }) {
  const [matches, setMatches] = useState<PresetCatalogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { engine, ui } = useWorkspace();

  const catalogEntryById = useMemo(() => {
    const map = new Map<string, PresetCatalogEntry>();
    for (const entry of engine.catalog) {
      map.set(entry.id, entry);
    }
    return map;
  }, [engine.catalog]);

  const handleSearch = useCallback(async () => {
    setLoading(true);
    setMatches(null);
    setError(null);
    try {
      const canvas = ui.stageRef.current?.querySelector(
        'canvas',
      ) as HTMLCanvasElement | null;
      if (!canvas) throw new Error('No canvas found');
      const results = await searchByFrame(canvas);
      if (results.length === 0) {
        setMatches([]);
      } else {
        const fullMatches = results
          .map((r) => catalogEntryById.get(r.presetId))
          .filter((e): e is PresetCatalogEntry => e !== undefined);
        setMatches(fullMatches);
      }
    } catch (err) {
      const error = err as Error;
      if (error.name !== 'AbortError') {
        setError(error.message);
      }
    } finally {
      setLoading(false);
    }
  }, [catalogEntryById, ui]);

  useEffect(() => {
    handleSearch();
  }, [handleSearch]);

  return (
    <div className="stims-shell__visualsearch-panel">
      <div className="stims-shell__visualsearch-header">
        <UiIcon
          name="eye"
          className="stims-shell__visualsearch-icon"
          aria-hidden="true"
        />
        <h3>More like this</h3>
        <p className="stims-shell__visualsearch-desc">
          Finding visually similar presets…
        </p>
      </div>
      {loading ? (
        <div className="stims-shell__visualsearch-loading">
          Analyzing frame…
        </div>
      ) : error ? (
        <div className="stims-shell__visualsearch-error">{error}</div>
      ) : matches ? (
        <ul className="stims-shell__visualsearch-results">
          {matches.length === 0 ? (
            <li className="stims-shell__visualsearch-empty">
              No similar presets found
            </li>
          ) : (
            matches.map((entry) => (
              <li key={entry.id} className="stims-shell__visualsearch-item">
                <button
                  type="button"
                  className="stims-shell__visualsearch-btn"
                  onClick={() => {
                    engine.handlePlayPreset(entry.id);
                    onClose();
                  }}
                >
                  <PresetArtwork entry={entry} compact />
                  <div className="stims-shell__visualsearch-info">
                    <span className="stims-shell__visualsearch-title">
                      {entry.title}
                    </span>
                    <span className="stims-shell__visualsearch-meta">
                      {entry.author ? (
                        <>
                          by{' '}
                          {resolveAuthorUrl(entry.author, entry.authorUrl) ? (
                            <a
                              href={resolveAuthorUrl(
                                entry.author,
                                entry.authorUrl,
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ctl-preset__author-link"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {entry.author}
                            </a>
                          ) : (
                            entry.author
                          )}
                        </>
                      ) : (
                        'Unknown author'
                      )}
                    </span>
                  </div>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : (
        <button
          type="button"
          className="stims-shell__visualsearch-refresh"
          onClick={handleSearch}
        >
          <UiIcon
            name="refresh"
            className="stims-icon-slot stims-icon-slot--sm"
            aria-hidden="true"
          />
          Analyze frame
        </button>
      )}
    </div>
  );
}
