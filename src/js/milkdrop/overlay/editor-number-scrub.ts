// Alt-drag numeric scrubbing for the preset code editor.
//
// MilkDrop source is mostly numeric literals, and the edit loop is "nudge a
// number, watch the stage". This extension turns every literal in the buffer
// into a slider: hold Alt and drag horizontally on a number to scrub it, or
// put the cursor inside one and press Alt+ArrowUp/Down. Both paths replace
// the token through an ordinary CodeMirror transaction, so the editor's
// existing debounced doc-change pipeline recompiles the preset live — no
// separate apply path.
//
// Step size is decimal-place aware, matching how the Tune tab formats values:
// `1.050` scrubs by 0.001, `0.05` by 0.01, `8` by 1. Holding Shift makes the
// step 10x coarser.

import type { Extension } from '@codemirror/state';
import { Prec } from '@codemirror/state';
import type { Command } from '@codemirror/view';
import { EditorView, keymap } from '@codemirror/view';

export interface NumericToken {
  /** Column of the first character (sign included) within the line. */
  start: number;
  /** Column just past the last character. */
  end: number;
  text: string;
}

/**
 * Finds the numeric literal covering `col` in `lineText`, or null. A leading
 * `-` is absorbed only when it reads as a sign (start of line, or after an
 * operator/delimiter) rather than as subtraction off an identifier or a
 * closing paren.
 */
export function findNumericTokenAt(
  lineText: string,
  col: number,
): NumericToken | null {
  const re = /\d+(?:\.\d+)?|\.\d+/g;
  let match = re.exec(lineText);
  while (match !== null) {
    let start = match.index;
    const end = start + match[0].length;
    if (start > 0 && lineText[start - 1] === '-') {
      const before = lineText.slice(0, start - 1).trimEnd();
      const prev = before.length > 0 ? before[before.length - 1] : '';
      if (prev === '' || !/[\w.)\]]/.test(prev)) {
        start -= 1;
      }
    }
    if (col >= start && col <= end) {
      return { start, end, text: lineText.slice(start, end) };
    }
    if (start > col) return null;
    match = re.exec(lineText);
  }
  return null;
}

/** 0.001 for `1.050`, 0.01 for `0.05`, 1 for `8` — one unit in the token's
 * last written decimal place. */
export function stepForToken(tokenText: string): number {
  const dot = tokenText.indexOf('.');
  if (dot === -1) return 1;
  const decimals = tokenText.length - dot - 1;
  return 10 ** -decimals;
}

/** Formats `value` with the same number of decimal places the original token
 * carried, so scrubbing never reformats the literal around the user. */
export function formatScrubbedValue(value: number, tokenText: string): string {
  const dot = tokenText.indexOf('.');
  const decimals = dot === -1 ? 0 : tokenText.length - dot - 1;
  return value.toFixed(decimals);
}

/** Horizontal pixels of drag per step — small enough to feel responsive,
 * large enough that a shaky hand doesn't jitter the value. */
const PIXELS_PER_STEP = 3;

const nudgeNumber =
  (direction: 1 | -1, coarse: boolean): Command =>
  (view) => {
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    const token = findNumericTokenAt(line.text, head - line.from);
    if (!token) return false;
    const value = Number.parseFloat(token.text);
    if (!Number.isFinite(value)) return false;
    const step = stepForToken(token.text) * (coarse ? 10 : 1);
    const next = formatScrubbedValue(value + direction * step, token.text);
    const from = line.from + token.start;
    view.dispatch({
      changes: { from, to: line.from + token.end, insert: next },
      selection: { anchor: from + next.length },
      scrollIntoView: true,
    });
    return true;
  };

function beginScrub(view: EditorView, event: MouseEvent): boolean {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return false;
  const line = view.state.doc.lineAt(pos);
  const token = findNumericTokenAt(line.text, pos - line.from);
  if (!token) return false;
  const startValue = Number.parseFloat(token.text);
  if (!Number.isFinite(startValue)) return false;

  event.preventDefault();
  const baseStep = stepForToken(token.text);
  const startX = event.clientX;
  const tokenFrom = line.from + token.start;
  let currentText = token.text;

  const body = document.body;
  const priorUserSelect = body.style.userSelect;
  const priorCursor = body.style.cursor;
  body.style.userSelect = 'none';
  body.style.cursor = 'ew-resize';

  const onMove = (move: MouseEvent) => {
    move.preventDefault();
    const step = baseStep * (move.shiftKey ? 10 : 1);
    const ticks = Math.round((move.clientX - startX) / PIXELS_PER_STEP);
    const next = formatScrubbedValue(startValue + ticks * step, token.text);
    if (next === currentText) return;
    view.dispatch({
      changes: {
        from: tokenFrom,
        to: tokenFrom + currentText.length,
        insert: next,
      },
      scrollIntoView: false,
    });
    currentText = next;
  };

  const onUp = () => {
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    body.style.userSelect = priorUserSelect;
    body.style.cursor = priorCursor;
  };

  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
  return true;
}

/**
 * The full extension: Alt+drag scrubbing plus its keyboard equivalent
 * (Alt+ArrowUp/Down, Shift for 10x). Wrapped in Prec.highest so the
 * mousedown wins over rectangularSelection's Alt-drag column selection when
 * the press lands on a number (elsewhere, column selection keeps working),
 * and so the arrow bindings shadow moveLineUp/copyLineUp only when the
 * cursor sits inside a numeric literal — the commands return false
 * otherwise and the default bindings still run.
 */
export function numberScrubExtension(): Extension {
  return [
    Prec.highest(
      EditorView.domEventHandlers({
        mousedown: (event, view) => {
          if (!event.altKey || event.button !== 0) return false;
          return beginScrub(view, event);
        },
      }),
    ),
    Prec.highest(
      keymap.of([
        { key: 'Alt-ArrowUp', run: nudgeNumber(1, false) },
        { key: 'Alt-ArrowDown', run: nudgeNumber(-1, false) },
        { key: 'Shift-Alt-ArrowUp', run: nudgeNumber(1, true) },
        { key: 'Shift-Alt-ArrowDown', run: nudgeNumber(-1, true) },
      ]),
    ),
  ];
}
