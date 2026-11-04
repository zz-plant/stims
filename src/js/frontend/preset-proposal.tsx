import { useCallback, useMemo, useState } from 'react';
import {
  type ActionSurface,
  noteActionUse,
} from '../core/services/action-telemetry.ts';
import {
  computeSourceDiff,
  samePresetSource,
} from '../milkdrop/overlay/source-diff.ts';
import { refinePresetSource } from './preset-refine.ts';

export type PresetProposal = {
  label: string;
  base: string;
  next: string;
  applied: string;
};

/**
 * A restyle or AI edit, held as a diff until someone presses Apply.
 *
 * It used to replace the running preset directly, with no way to see what
 * changed and nothing to undo it with, and the result was saved as the
 * preset's draft. Shared by the Refine panel and the editor's describe field,
 * so both review a change the same way.
 */
export function usePresetProposal({
  currentSource,
  applySource,
  surface,
  aiUnavailableNote,
}: {
  currentSource: string;
  applySource: (source: string) => void;
  surface: ActionSurface;
  /** What still works here, said when the AI service does not answer. */
  aiUnavailableNote: string;
}) {
  const [proposal, setProposal] = useState<PresetProposal | null>(null);
  const [response, setResponse] = useState<string | null>(null);

  // Only state setters inside, so one identity serves every render.
  const propose = useCallback(
    (label: string, base: string, next: string, applied: string) => {
      if (samePresetSource(base, next)) {
        setProposal(null);
        setResponse(`${label} would not change this preset.`);
        return;
      }
      setResponse(null);
      setProposal({ label, base, next, applied });
    },
    [],
  );

  const apply = () => {
    if (!proposal) return;
    // The diff was computed against `base`; applying it over anything else
    // (an edit made meanwhile, another preset) would discard that.
    if (!samePresetSource(proposal.base, currentSource)) {
      setProposal(null);
      setResponse(
        `${proposal.label}: the preset changed while this was open, so nothing was applied. Run it again.`,
      );
      return;
    }
    noteActionUse('apply-proposed-change', surface);
    applySource(proposal.next);
    setResponse(proposal.applied);
    setProposal(null);
  };

  const describeChange = async (instruction: string) => {
    noteActionUse('describe-change', surface);
    // The attempt runs as an inner function so its early returns end the
    // attempt instead of the handler. A `finally` clause or a throw inside
    // try is a whole-file React Compiler bailout.
    const attempt = async () => {
      const refinement = await refinePresetSource(currentSource, instruction);
      if (refinement.method === 'none') {
        setResponse(
          `AI is unavailable (${refinement.aiError}). ${aiUnavailableNote}`,
        );
        return;
      }
      // The fallback is named in the proposal's own heading: it used to look
      // like the AI's answer until after Apply, and the note said "applied"
      // about a change still waiting for review.
      propose(
        refinement.method === 'ai'
          ? 'AI refinement'
          : `${refinement.label} restyle, not from AI`,
        currentSource,
        refinement.milkSource,
        refinement.method === 'ai'
          ? refinement.title
            ? `Refined: ${refinement.title}`
            : 'Change applied.'
          : `AI is unavailable, so this is the ${refinement.label} restyle, made in this browser. Review it before applying.`,
      );
    };
    try {
      await attempt();
    } catch (err) {
      const error = err as Error;
      setResponse(`Could not apply the change: ${error.message}`);
    }
  };

  return {
    proposal,
    response,
    setResponse,
    propose,
    apply,
    discard: () => setProposal(null),
    describeChange,
  };
}

export function ProposalReview({
  proposal,
  onApply,
  onDiscard,
}: {
  proposal: PresetProposal;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const diff = useMemo(
    () => computeSourceDiff(proposal.base, proposal.next),
    [proposal],
  );
  return (
    <section
      className="stims-shell__refine-proposal"
      aria-label={`${proposal.label}: proposed change`}
    >
      <p className="stims-shell__refine-proposal-head">
        {proposal.label} — review the change
      </p>
      <pre className="stims-shell__refine-diff">
        {diff.map((line, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: diff rows are positional and re-rendered whole
            key={index}
            className={`stims-shell__refine-diff-line stims-shell__refine-diff-line--${line.kind}`}
          >
            {line.kind === 'add'
              ? '+ '
              : line.kind === 'del'
                ? '- '
                : line.kind === 'gap'
                  ? '⋯ '
                  : '  '}
            {line.text}
            {'\n'}
          </span>
        ))}
      </pre>
      <div className="stims-shell__refine-actions">
        <button
          type="button"
          className="stims-shell__refine-btn"
          onClick={onApply}
        >
          Apply
        </button>
        <button
          type="button"
          className="stims-shell__refine-btn stims-shell__refine-btn--secondary"
          onClick={onDiscard}
        >
          Discard
        </button>
      </div>
    </section>
  );
}
