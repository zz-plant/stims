import { useState } from 'react';
import { noteGrowthEvent } from '../core/services/preset-telemetry.ts';
import { readStored, writeStored } from '../core/state/browser-storage.ts';
import {
  addSpinExample,
  type SpinExample,
  undoSpinExample,
} from './first-edit.ts';

const DISMISSED_KEY = 'stims:first-edit-dismissed';

/**
 * Two rows: the title with its actions, then one line of instruction or,
 * once the example is in, its result. It sits above the code on the first
 * open, so every row it takes is a line of code the visitor does not see.
 */
export function FirstEditGuide({
  source,
  onChange,
}: {
  source: string;
  onChange: (source: string) => void;
}) {
  const [dismissed, setDismissed] = useState(
    () => readStored(DISMISSED_KEY) === '1',
  );
  const [edit, setEdit] = useState<SpinExample | null>(null);
  if (dismissed || !source) return null;
  // `source` reads as the original until the session echoes the edit back.
  // Counting that as undoable keeps the button enabled through the round
  // trip; disabling it for a frame threw keyboard focus to the page.
  const canUndo =
    edit !== null &&
    (source === edit.before || undoSpinExample(source, edit) !== null);
  return (
    <section className="stims-editor-intro" aria-label="Try one edit">
      <div className="stims-editor-intro__heading">
        <strong>Try one edit</strong>
        {/* One button that turns into its own undo, so keyboard focus stays
            on it instead of falling to the page when it is pressed. */}
        <button
          type="button"
          disabled={edit !== null && !canUndo}
          onClick={() => {
            if (edit === null) {
              const next = addSpinExample(source);
              setEdit(next);
              onChange(next.after);
              noteGrowthEvent('first-edit-applied');
              return;
            }
            if (!canUndo) return;
            onChange(edit.before);
            setEdit(null);
          }}
        >
          {edit ? 'Undo example' : 'Add a slow spin'}
        </button>
        <button
          type="button"
          aria-label="Dismiss editing tip"
          onClick={() => {
            writeStored(DISMISSED_KEY, '1');
            setDismissed(true);
          }}
        >
          Dismiss
        </button>
      </div>
      <p hidden={edit !== null}>
        Add <code>rot=rot+0.02;</code> to the per-frame equations and watch the
        feedback turn.
      </p>
      <p role="status">
        {edit === null
          ? null
          : canUndo
            ? 'Spin added. Try changing 0.02, or copy a remix link from the editor toolbar.'
            : 'Your source has changed. Use the editor’s undo to step back through your edits.'}
      </p>
    </section>
  );
}
