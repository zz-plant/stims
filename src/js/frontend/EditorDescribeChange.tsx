import { useState } from 'react';
import { ProposalReview, usePresetProposal } from './preset-proposal.tsx';

/**
 * Describe a change in words, from the editor itself.
 *
 * The AI tools sat in a menu row people rarely reached, while the editor is
 * where they already are when they want a change they cannot write. One row:
 * it sits above the code, and every row here is a line of code not shown.
 */
export function EditorDescribeChange({
  source,
  onChange,
}: {
  source: string;
  onChange: (source: string) => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [asking, setAsking] = useState(false);
  const change = usePresetProposal({
    currentSource: source,
    applySource: onChange,
    surface: 'editor',
    aiUnavailableNote: 'You can still edit the code directly.',
  });

  const submit = async () => {
    const wanted = instruction.trim();
    if (!wanted || !source || asking) return;
    setAsking(true);
    await change.describeChange(wanted);
    setAsking(false);
  };

  return (
    <section className="stims-editor-describe" aria-label="Describe a change">
      <form
        className="stims-editor-describe__row"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          type="text"
          className="stims-editor-describe__input"
          aria-label="Describe a change for the AI to make"
          placeholder="Describe a change: more blue, slower spin…"
          value={instruction}
          disabled={asking}
          onChange={(event) => setInstruction(event.target.value)}
        />
        <button
          type="submit"
          className="stims-editor-describe__submit"
          disabled={asking || !instruction.trim() || !source}
        >
          {asking ? 'Asking…' : 'Ask AI'}
        </button>
      </form>
      {/* Said once there is something to send, not on every open. */}
      {instruction.trim() ? (
        <p className="stims-editor-describe__note">
          Sends this preset’s code to the AI model. You review the change before
          it applies.
        </p>
      ) : null}
      {change.proposal ? (
        <ProposalReview
          proposal={change.proposal}
          onApply={() => {
            change.apply();
            setInstruction('');
          }}
          onDiscard={change.discard}
        />
      ) : null}
      {change.response ? (
        <p className="stims-editor-describe__note" role="status">
          {change.response}
        </p>
      ) : null}
    </section>
  );
}
