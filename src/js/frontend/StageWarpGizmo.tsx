import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isFieldShadowedByEquations,
  readMilkdropField,
  upsertMilkdropFields,
} from '../milkdrop/formatter.ts';
import { useEngineSnapshot } from './engine-context.tsx';
import { useWorkspace } from './workspace-context.tsx';

/**
 * `cx`/`cy` is the point every warp, zoom and rotation turns around. As two
 * 0..1 faders in a side panel it is a number you adjust and then look up to
 * see where it went; on the stage it is the thing itself, so the control is
 * just dragging it.
 *
 * MilkDrop's cx runs left→right and its cy runs top→bottom over the visible
 * frame (see normalizeTransformCenter/Y in vm/shared.ts), and the canvas fills
 * the stage root edge to edge, so stage-relative fractions map straight onto
 * the fields with no letterbox correction.
 */
const CENTER_FIELDS = ['cx', 'cy'] as const;

export function StageWarpGizmo() {
  const { engine, ui } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const source = engineSnapshot?.sessionState?.source ?? null;
  // Pointer moves outrun React's commit, so the drag handler writes against
  // the newest source it has seen rather than the one captured at mousedown —
  // otherwise a fast drag replays a stale buffer and drops any edit the code
  // pane committed mid-gesture.
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const cx = source === null ? 0.5 : (readMilkdropField(source, 'cx') ?? 0.5);
  const cy = source === null ? 0.5 : (readMilkdropField(source, 'cy') ?? 0.5);
  const driven =
    source !== null &&
    CENTER_FIELDS.some((field) => isFieldShadowedByEquations(source, field));

  // Coalesce to one write per frame: a pointermove burst would otherwise
  // queue a recompile per event.
  const pendingRef = useRef<{ cx: number; cy: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    rafRef.current = null;
    const pending = pendingRef.current;
    const current = sourceRef.current;
    pendingRef.current = null;
    if (!pending || current === null) return;
    const next = upsertMilkdropFields(current, {
      cx: pending.cx,
      cy: pending.cy,
    });
    if (next !== current) {
      sourceRef.current = next;
      engine.updateEditorSource(next);
    }
  }, [engine]);

  const writeFromPointer = useCallback(
    (clientX: number, clientY: number, immediate = false) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      pendingRef.current = {
        cx: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
        cy: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
      };
      // The gesture's first and last positions are written straight through.
      // Coalescing those into a frame loses them outright wherever no frame
      // arrives — a throttled or hidden tab never runs rAF at all — and a
      // dropped final position is the one the user actually chose.
      if (immediate) {
        if (rafRef.current !== null) {
          window.cancelAnimationFrame(rafRef.current);
        }
        flush();
        return;
      }
      rafRef.current ??= window.requestAnimationFrame(flush);
    },
    [flush],
  );

  useEffect(
    () => () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    },
    [],
  );

  // The drag is tracked on the window rather than through
  // setPointerCapture on the handle: capture throws for a pointerId the
  // element never saw (synthetic input, some pen/touch stacks), and it threw
  // before the handler had done anything, so the whole gesture was lost. This
  // also keeps the drag alive when the pointer leaves the stage.
  useEffect(() => {
    if (!dragging) return;

    const onMove = (event: PointerEvent) => {
      event.preventDefault();
      writeFromPointer(event.clientX, event.clientY);
    };
    const onUp = (event: PointerEvent) => {
      writeFromPointer(event.clientX, event.clientY, true);
      setDragging(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, writeFromPointer]);

  const nudge = useCallback(
    (dx: number, dy: number) => {
      const current = sourceRef.current;
      if (current === null) return;
      const next = upsertMilkdropFields(current, {
        cx: Math.min(1, Math.max(0, cx + dx)),
        cy: Math.min(1, Math.max(0, cy + dy)),
      });
      if (next !== current) {
        sourceRef.current = next;
        engine.updateEditorSource(next);
      }
    },
    [cx, cy, engine],
  );

  if (ui.routeState.panel !== 'editor' || source === null) {
    return null;
  }

  const label = `Warp centre: cx ${cx.toFixed(3)}, cy ${cy.toFixed(3)}`;

  return (
    // The layer itself is inert; only the handle takes the pointer, so
    // clicking the visual still reaches whatever is behind it.
    <div ref={rootRef} className="stims-stage-gizmo" aria-hidden={false}>
      <button
        type="button"
        className="stims-stage-gizmo__handle"
        data-dragging={dragging ? 'true' : undefined}
        data-driven={driven ? 'true' : undefined}
        style={{ left: `${cx * 100}%`, top: `${cy * 100}%` }}
        aria-label={
          driven
            ? `${label}. This preset recomputes the centre every frame, so dragging sets only the starting value.`
            : `${label}. Drag, or use the arrow keys.`
        }
        title={
          driven
            ? 'The preset reassigns cx/cy every frame — this marker shows the literal value in the draft, not where the warp is actually centred.'
            : 'Drag to move the warp centre. Arrow keys nudge; hold Shift for coarse steps.'
        }
        onPointerDown={(event) => {
          event.preventDefault();
          setDragging(true);
          writeFromPointer(event.clientX, event.clientY, true);
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 0.05 : 0.005;
          const delta =
            event.key === 'ArrowLeft'
              ? [-step, 0]
              : event.key === 'ArrowRight'
                ? [step, 0]
                : event.key === 'ArrowUp'
                  ? [0, -step]
                  : event.key === 'ArrowDown'
                    ? [0, step]
                    : null;
          if (!delta) return;
          // Also stop propagation: ArrowLeft/ArrowRight double as the global
          // previous/shuffle preset shortcuts on document.
          event.preventDefault();
          event.stopPropagation();
          nudge(delta[0], delta[1]);
        }}
      >
        <span className="stims-stage-gizmo__readout">
          {driven ? 'cx/cy · eq' : `${cx.toFixed(2)}, ${cy.toFixed(2)}`}
        </span>
      </button>
    </div>
  );
}
