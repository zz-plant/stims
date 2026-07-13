import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import styles from '../../css/SidePanel.module.css';
import { useEngineSnapshot } from './engine-context.tsx';
import { UiIcon } from './UiIcon.tsx';
import { useWorkspace } from './workspace-context.tsx';

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
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  const startClose = useCallback(() => {
    if (exiting || closeTimerRef.current) return;
    setExiting(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, 200);
  }, [exiting, onClose]);

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
      const activeElement = document.activeElement;
      previouslyFocusedRef.current =
        activeElement instanceof HTMLElement ? activeElement : null;
      wasOpenRef.current = true;
      if (onOpen) requestAnimationFrame(onOpen);
    }
  }, [open, onOpen]);

  useEffect(() => {
    if (open || !wasOpenRef.current) return;
    wasOpenRef.current = false;
    const el = previouslyFocusedRef.current;
    previouslyFocusedRef.current = null;
    if (
      el?.isConnected &&
      !document.activeElement?.closest('[role="dialog"]')
    ) {
      el.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open || exiting) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        startClose();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    panelRef.current?.focus();
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
        tabIndex={-1}
      >
        <div className={styles.header}>
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

export function RefinePanel({ onClose }: { onClose: () => void }) {
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
    } catch (err: any) {
      setResponse(`Error: ${err.message}`);
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
    } catch (err: any) {
      setResponse(`Error: ${err.message}`);
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
