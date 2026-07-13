import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import styles from '../../css/SidePanel.module.css';
import { UiIcon } from './UiIcon';

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
