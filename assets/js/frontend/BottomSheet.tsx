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

type SheetPosition = 'bottom' | 'right' | 'left';

type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: ReactNode;
  tabs?: BottomSheetTab[];
  position?: SheetPosition;
  onOpen?: () => void;
};

export function BottomSheet({
  open,
  onClose,
  title,
  description,
  children,
  tabs,
  position = 'bottom',
  onOpen,
}: BottomSheetProps) {
  const [exiting, setExiting] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef(0);
  const dragCurrent = useRef(0);
  const dragging = useRef(false);

  const startClose = useCallback(() => {
    setExiting(true);
    setTimeout(onClose, 250);
  }, [onClose]);

  useEffect(() => {
    if (open) {
      setExiting(false);
      if (onOpen) {
        requestAnimationFrame(onOpen);
      }
    }
  }, [open, onOpen]);

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

  const _dragAxis = position === 'bottom' ? 'Y' : 'X';
  const dragThreshold = 100;

  const handleDragStart = useCallback((clientPos: number) => {
    dragStart.current = clientPos;
    dragging.current = true;
  }, []);

  const handleDragMove = useCallback(
    (clientPos: number) => {
      if (!dragging.current) return;
      dragCurrent.current = clientPos;
      const delta = dragCurrent.current - dragStart.current;
      const isPositive = position === 'bottom' ? delta > 0 : delta < 0;
      if (isPositive && sheetRef.current) {
        const translate =
          position === 'bottom'
            ? `translateY(${delta}px)`
            : `translateX(${Math.abs(delta)}px)`;
        sheetRef.current.style.transform = translate;
      }
    },
    [position],
  );

  const handleDragEnd = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    const delta = dragCurrent.current - dragStart.current;
    if (sheetRef.current) {
      sheetRef.current.style.transform = '';
    }
    if (Math.abs(delta) > dragThreshold) {
      startClose();
    }
    dragStart.current = 0;
    dragCurrent.current = 0;
  }, [startClose]);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      handleDragStart(
        position === 'bottom' ? e.touches[0].clientY : e.touches[0].clientX,
      );
    },
    [handleDragStart, position],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      handleDragMove(
        position === 'bottom' ? e.touches[0].clientY : e.touches[0].clientX,
      );
    },
    [handleDragMove, position],
  );

  const handleTouchEnd = useCallback(() => {
    handleDragEnd();
  }, [handleDragEnd]);

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
        data-position={position}
        data-exiting={String(exiting)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        {position === 'bottom' ? (
          <div
            className={styles.handle}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <span className={styles.handleBar} />
          </div>
        ) : null}

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
