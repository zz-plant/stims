import { useState } from 'react';
import { noteGrowthEvent } from '../core/services/preset-telemetry.ts';
import { readStored, writeStored } from '../core/state/browser-storage.ts';
import {
  addSpinExample,
  type SpinExample,
  undoSpinExample,
} from './first-edit.ts';

const DISMISSED_KEY = 'stims:first-edit-dismissed';

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
  const canUndo = edit !== null && undoSpinExample(source, edit) !== null;
  return (
    <section className="stims-editor-intro" aria-label="Try one edit">
      <div className="stims-editor-intro__heading">
        <strong>Try one edit</strong>
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
      <p>
        Add <code>rot=rot+0.02;</code> to the per-frame equations and watch the
        feedback turn. The code below stays editable.
      </p>
      <div className="stims-editor-intro__actions">
        <button
          type="button"
          disabled={edit !== null}
          onClick={() => {
            const next = addSpinExample(source);
            setEdit(next);
            onChange(next.after);
            noteGrowthEvent('first-edit-applied');
          }}
        >
          Add a slow spin
        </button>
        {edit ? (
          <button
            type="button"
            disabled={!canUndo}
            onClick={() => {
              const before = undoSpinExample(source, edit);
              if (before === null) return;
              onChange(before);
              setEdit(null);
            }}
          >
            Undo example
          </button>
        ) : null}
      </div>
      {edit ? (
        <p role="status">
          {canUndo
            ? 'Spin added. Try changing 0.02, or copy a remix link from the editor toolbar.'
            : 'Your source has changed. Use the editor’s undo to step back through your edits.'}
        </p>
      ) : null}
    </section>
  );
}
