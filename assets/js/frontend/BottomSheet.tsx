import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import styles from '../../css/BottomSheet.module.css';
import { UiIcon } from './UiIcon';

type BottomSheetTab = {
  id: string;
  label: string;
  active: boolean;
  onSelect: () => void;
};

type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: ReactNode;
  tabs?: BottomSheetTab[];
};

export function BottomSheet({
  open,
  onClose,
  title,
  description,
  children,
  tabs,
}: BottomSheetProps) {
  const [exiting, setExiting] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragCurrentY = useRef(0);
  const dragging = useRef(false);

  const startClose = useCallback(() => {
    setExiting(true);
    setTimeout(onClose, 250);
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      setExiting(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || exiting) return;

    const handleKey = (e: Event) => {
      const ke = e as unknown as KeyboardEvent;
      if (ke.key === 'Escape') {
        startClose();
        return;
      }
      if (ke.key === 'Tab' && sheetRef.current) {
        const focusable = sheetRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0] as HTMLElement;
        const last = focusable[focusable.length - 1] as HTMLElement;
        if (ke.shiftKey && document.activeElement === first) {
          ke.preventDefault();
          last?.focus();
        } else if (!ke.shiftKey && document.activeElement === last) {
          ke.preventDefault();
          first?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKey);
    sheetRef.current?.focus();

    return () => document.removeEventListener('keydown', handleKey);
  }, [open, exiting, startClose]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
    dragging.current = true;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragging.current) return;
    dragCurrentY.current = e.touches[0].clientY;
    const dy = dragCurrentY.current - dragStartY.current;
    if (dy > 0 && sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${dy}px)`;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    const dy = dragCurrentY.current - dragStartY.current;
    if (sheetRef.current) {
      sheetRef.current.style.transform = '';
    }
    if (dy > 100) {
      startClose();
    }
    dragStartY.current = 0;
    dragCurrentY.current = 0;
  }, [startClose]);

  if (!open && !exiting) return null;

  return (
    <>
      <button
        type="button"
        className={styles.backdrop}
        data-exiting={String(exiting)}
        onClick={startClose}
        aria-label="Close"
        tabIndex={-1}
      />
      <div
        ref={sheetRef}
        className={styles.sheet}
        data-exiting={String(exiting)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div
          className={styles.handle}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <span className={styles.handleBar} />
        </div>

        <div className={styles.header}>
          <div className={styles.headingGroup}>
            <h2 className={styles.title}>{title}</h2>
            <p className={styles.description}>{description}</p>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={startClose}
            aria-label="Close"
          >
            <UiIcon
              name="close"
              className="stims-icon-slot stims-icon-slot--sm"
            />
          </button>
        </div>

        {tabs && tabs.length > 0 ? (
          <nav className={styles.tabs} aria-label="Tool sections">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={styles.tab}
                data-active={String(tab.active)}
                onClick={tab.onSelect}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        ) : null}

        <div className={styles.body}>{children}</div>
      </div>
    </>
  );
}
