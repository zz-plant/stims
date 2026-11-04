import { useState } from 'react';
import { readStored, writeStored } from '../core/state/browser-storage.ts';
import type { MilkdropEditorSessionState } from '../milkdrop/types.ts';

const DISMISSED_KEY = 'stims:share-offer-dismissed';

/**
 * Offers the link at the moment someone has something to send. Only for a
 * draft that compiles: a link to a broken edit is nothing to pass on.
 */
export function EditorShareOffer({
  session,
  shared,
  onCopyLink,
}: {
  session: MilkdropEditorSessionState | null;
  /** The link has been copied, so the offer has done its job. */
  shared: boolean;
  onCopyLink: () => void;
}) {
  const [dismissed, setDismissed] = useState(
    () => readStored(DISMISSED_KEY) === '1',
  );
  if (!session?.dirty || shared || dismissed) return null;
  if (session.diagnostics.some((entry) => entry.severity === 'error')) {
    return null;
  }
  return (
    <section className="stims-editor-intro" aria-label="Share this edit">
      <div className="stims-editor-intro__heading">
        <strong>Your edit travels in the link</strong>
        <button
          type="button"
          data-action="share-after-edit"
          onClick={onCopyLink}
        >
          Copy link
        </button>
        <button
          type="button"
          aria-label="Dismiss sharing tip"
          onClick={() => {
            writeStored(DISMISSED_KEY, '1');
            setDismissed(true);
          }}
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}
