/**
 * The one panel shell every side surface renders into: browse, the editor,
 * settings, refine. It owns the chrome around the content — focus trap, close
 * affordances, the desktop editor/stage seam, and the mobile bottom sheet's
 * drag-to-dismiss — and nothing about what any particular panel shows.
 *
 * Panel content lives in its own component and is handed in as children; the
 * route state that decides which one is open lives in the workspace context.
 */
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import styles from '../../css/SidePanel.module.css';
import { useFocusTrap } from './hooks/use-focus-trap.ts';
import { UiIcon } from './UiIcon.tsx';

const isMobileSheet = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(max-width: 767px)').matches ||
    window.matchMedia('(max-height: 500px) and (pointer: coarse)').matches);

/* Stage-anchored seam: the editor/stage split is user-resizable on desktop.
   The chosen width feeds --stage-tool-width on the shell root, which sizes
   both this panel and the transport dock's inset, and persists across
   sessions. */
const SEAM_STORAGE_KEY = 'stims:stage-tool-width';
const SEAM_DEFAULT_WIDTH = 560;
const SEAM_MIN_WIDTH = 380;
/** Keep at least this much stage visible beside the editor. */
const SEAM_STAGE_RESERVE = 480;
const SEAM_KEY_STEP = 24;

const seamMaxWidth = () =>
  Math.max(SEAM_MIN_WIDTH, window.innerWidth - SEAM_STAGE_RESERVE);

const clampSeamWidth = (width: number) =>
  Math.round(Math.min(seamMaxWidth(), Math.max(SEAM_MIN_WIDTH, width)));

const readStoredSeamWidth = (): number | null => {
  if (typeof localStorage === 'undefined') return null;
  const raw = Number(localStorage.getItem(SEAM_STORAGE_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : null;
};

const shellRootStyle = () =>
  document.getElementById('stims-main')?.style ?? null;

type SidePanelProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  onOpen?: () => void;
  // When true, the panel is "stage-anchored": no full-screen backdrop is
  // rendered, so the live stage and its transport dock stay visible and
  // clickable beside the panel. Used by the editor.
  stageAnchored?: boolean;
  // When true, the body stops being a scroll container and becomes a
  // fixed-height flex column instead, so the panel's content manages its own
  // scrolling regions. The editor needs this: as a plain scroll container the
  // body let CodeMirror render its whole document at full height, pushing
  // every tool below the code thousands of pixels out of reach.
  fillBody?: boolean;
};

export function SidePanel({
  open,
  onClose,
  title,
  children,
  onOpen,
  stageAnchored = false,
  fillBody = false,
}: SidePanelProps) {
  const [exiting, setExiting] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const isActive = open && !exiting;
  const panelRef = useFocusTrap<HTMLDivElement>({
    active: isActive,
    autoFocus: true,
    restoreFocusOnUnmount: true,
    // Stage-anchored panels are non-modal: the stage and dock stay usable
    // beside them (for pointer AND keyboard), so focus must not be fenced in.
    trapFocus: !stageAnchored,
    // Land on the dialog itself, never on a control inside it. The two
    // candidates in DOM order are both wrong as an opening move: the editor's
    // resize seam, and the close button — which made "dismiss this" the
    // highlighted default of every panel you deliberately opened, and had
    // screen readers announce "Close, button" in place of the panel's name.
    initialFocus: 'container',
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

  // pointercancel is the system taking the gesture away — a call arriving, an
  // edge swipe winning — not a decision to dismiss. Routing it through
  // handleDragEnd meant a cancel that happened to land 96px down closed the
  // sheet on the user's behalf. Put the sheet back instead.
  const handleDragCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const panel = panelRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;
      if (!panel) return;
      panel.style.transition = 'transform 0.2s ease';
      panel.style.transform = '';
    },
    [panelRef],
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

  // Resizable editor/stage seam (desktop, stage-anchored only).
  const [seamWidth, setSeamWidth] = useState<number | null>(
    readStoredSeamWidth,
  );
  const seamDragRef = useRef<{ pointerId: number; width: number } | null>(null);

  const commitSeamWidth = useCallback((width: number | null) => {
    setSeamWidth(width);
    try {
      if (width === null) {
        localStorage.removeItem(SEAM_STORAGE_KEY);
      } else {
        localStorage.setItem(SEAM_STORAGE_KEY, String(width));
      }
    } catch {
      // private mode / quota — the width still applies for this session
    }
  }, []);

  useEffect(() => {
    if (!stageAnchored) return;
    const style = shellRootStyle();
    if (!style) return;
    if (seamWidth === null) {
      style.removeProperty('--stage-tool-width');
    } else {
      style.setProperty('--stage-tool-width', `${clampSeamWidth(seamWidth)}px`);
    }
  }, [stageAnchored, seamWidth]);

  const handleSeamPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.isPrimary) return;
      seamDragRef.current = {
        pointerId: e.pointerId,
        width: seamWidth ?? SEAM_DEFAULT_WIDTH,
      };
      e.currentTarget.setAttribute('data-resizing', 'true');
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // synthetic pointer — move events still arrive via the seam itself
      }
    },
    [seamWidth],
  );

  const handleSeamPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = seamDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const width = clampSeamWidth(window.innerWidth - e.clientX);
      drag.width = width;
      // Applied imperatively so the editor subtree doesn't re-render per move.
      shellRootStyle()?.setProperty('--stage-tool-width', `${width}px`);
    },
    [],
  );

  const handleSeamPointerEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = seamDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      seamDragRef.current = null;
      e.currentTarget.removeAttribute('data-resizing');
      commitSeamWidth(drag.width);
    },
    [commitSeamWidth],
  );

  const handleSeamKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const current = clampSeamWidth(seamWidth ?? SEAM_DEFAULT_WIDTH);
      // stopPropagation: ArrowLeft/ArrowRight are also the global
      // previous/shuffle preset shortcuts on document — a resize nudge must
      // not switch presets underneath the editor.
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        commitSeamWidth(clampSeamWidth(current + SEAM_KEY_STEP));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        commitSeamWidth(clampSeamWidth(current - SEAM_KEY_STEP));
      } else if (e.key === 'Enter') {
        // Keyboard path for the double-click reset.
        e.preventDefault();
        e.stopPropagation();
        commitSeamWidth(null);
      }
    },
    [seamWidth, commitSeamWidth],
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
      {stageAnchored ? null : (
        <div
          className={styles.backdrop}
          data-exiting={String(exiting)}
          onClick={startClose}
          aria-hidden="true"
        />
      )}
      <div
        ref={panelRef}
        className={styles.panel}
        data-exiting={String(exiting)}
        data-stage-anchored={stageAnchored ? 'true' : undefined}
        role="dialog"
        aria-modal={stageAnchored ? undefined : 'true'}
        aria-label={title}
        data-shell-dialog="true"
        tabIndex={-1}
      >
        {stageAnchored ? (
          <>
            {/* biome-ignore lint/a11y/useSemanticElements: focusable window-splitter (WAI-ARIA APG pattern); <hr> cannot take focus or a value */}
            <div
              className={styles.seam}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize editor panel"
              aria-keyshortcuts="ArrowLeft ArrowRight Enter"
              aria-valuemin={SEAM_MIN_WIDTH}
              aria-valuemax={
                typeof window !== 'undefined'
                  ? seamMaxWidth()
                  : SEAM_DEFAULT_WIDTH
              }
              aria-valuenow={clampSeamWidth(seamWidth ?? SEAM_DEFAULT_WIDTH)}
              tabIndex={0}
              title="← → to resize · Enter or double-click to reset"
              onPointerDown={handleSeamPointerDown}
              onPointerMove={handleSeamPointerMove}
              onPointerUp={handleSeamPointerEnd}
              onPointerCancel={handleSeamPointerEnd}
              onKeyDown={handleSeamKeyDown}
              onDoubleClick={() => commitSeamWidth(null)}
            />
            {/* Silent until the seam itself has focus — a persistent hint on
                a 12px-wide sliver almost nobody touches would be pure
                clutter; this only needs to confirm the arrow-key path right
                when someone's actually found their way to it. */}
            <span className={styles.seamHint} aria-hidden="true">
              ← →
            </span>
          </>
        ) : null}
        <div
          className={styles.header}
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragCancel}
        >
          <div className={styles.grabber} aria-hidden="true" />
          <h2 className={styles.title}>{title}</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={startClose}
            aria-label="Close"
            // Esc closes every panel and is in the shortcut registry, but the
            // one control for it advertised nothing.
            title="Close (Esc)"
            aria-keyshortcuts="Escape"
          >
            <UiIcon
              name="close"
              className="stims-icon-slot stims-icon-slot--sm"
            />
          </button>
        </div>
        <div className={styles.body} data-fill={fillBody ? 'true' : undefined}>
          {children}
        </div>
      </div>
    </>
  );
}
