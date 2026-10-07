import { useCallback, useMemo, useState } from 'react';
import {
  computeSourceDiff,
  samePresetSource,
} from '../milkdrop/overlay/source-diff.ts';
import {
  analyzePresetMath,
  type PresetMathAnalysis,
} from '../milkdrop/preset-math-analyzer.ts';
import {
  mutatePresetStyle,
  PRESET_MUTATION_STYLES,
  type PresetMutationStyle,
} from '../milkdrop/preset-mutations.ts';
import { useEngineSnapshot } from './engine-context.tsx';
import { refinePresetSource, restyleLabel } from './preset-refine.ts';
import { useWorkspace } from './workspace-context.tsx';

export function RefinePanel() {
  const [instruction, setInstruction] = useState('');
  const [state, setState] = useState<'idle' | 'refining' | 'explaining'>(
    'idle',
  );
  const [response, setResponse] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<PresetMathAnalysis | null>(null);
  // A restyle or AI edit is shown as a diff first and applied only on
  // Apply. It used to replace the running preset directly, with no way to
  // see what changed and nothing to undo it with, and the result was saved
  // as the preset's draft.
  const [proposal, setProposal] = useState<{
    label: string;
    base: string;
    next: string;
    applied: string;
  } | null>(null);
  const { engine, ui } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const currentSource = engineSnapshot?.currentSource ?? '';

  // Only state setters inside, so one identity serves every render.
  const propose = useCallback(
    (label: string, base: string, next: string, applied: string) => {
      setAnalysis(null);
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

  const applyProposal = () => {
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
    engine.updateEditorSource(proposal.next);
    setResponse(proposal.applied);
    setProposal(null);
  };

  const proposalDiff = useMemo(
    () => (proposal ? computeSourceDiff(proposal.base, proposal.next) : []),
    [proposal],
  );

  const handleApplyMutation = useCallback(
    async (style: PresetMutationStyle) => {
      if (!currentSource) return;
      setState('refining');
      const label = restyleLabel(style);
      ui.setStatusMessage(`Applying ${label}…`);
      try {
        const mutatedSource = mutatePresetStyle(currentSource, style);
        propose(label, currentSource, mutatedSource, `Applied ${label}.`);
      } catch (err) {
        const error = err as Error;
        setResponse(`Could not apply ${label}: ${error.message}`);
      } finally {
        setState('idle');
        ui.setStatusMessage(null);
      }
    },
    [currentSource, propose, ui],
  );

  const handleRefine = useCallback(async () => {
    if (!instruction.trim() || !currentSource) return;
    setState('refining');
    ui.setStatusMessage('Refining preset…');
    try {
      const refinement = await refinePresetSource(
        currentSource,
        instruction.trim(),
      );
      if (refinement.method === 'none') {
        setResponse(
          `AI is unavailable (${refinement.aiError}). The restyle buttons above still work.`,
        );
        return;
      }
      propose(
        refinement.method === 'ai' ? 'AI refinement' : refinement.label,
        currentSource,
        refinement.milkSource,
        refinement.method === 'ai'
          ? `Refined: ${refinement.title || 'untitled preset'}`
          : `AI is unavailable, so the ${refinement.label} restyle was applied.`,
      );
    } catch (err) {
      const error = err as Error;
      setResponse(`Could not apply the change: ${error.message}`);
    } finally {
      setState('idle');
      ui.setStatusMessage(null);
    }
  }, [currentSource, instruction, propose, ui]);

  const handleExplain = useCallback(async () => {
    if (!currentSource) return;
    setState('explaining');
    ui.setStatusMessage('Reading the equations…');
    try {
      // 1. Try remote model if configured
      const res = await fetch('/api/refine-preset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentSource,
          instruction: 'explain this preset',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setResponse(data.explanation || data.message || null);
      } else {
        throw new Error(`Server status ${res.status}`);
      }
    } catch (err) {
      console.debug(
        'Remote explain failed, falling back to local AST analysis:',
        err,
      );
      // 2. Local fallback: a summary read from the equations themselves
      const mathAnalysis = analyzePresetMath(currentSource);
      setAnalysis(mathAnalysis);
      setResponse(mathAnalysis.summary);
    } finally {
      setState('idle');
      ui.setStatusMessage(null);
    }
  }, [currentSource, ui]);

  return (
    <div className="stims-shell__refine-panel">
      <p className="stims-shell__meta-copy">
        Restyle the preset in one click, describe a change for the AI to make,
        or get a summary of what its equations do.
      </p>

      <div
        className="stims-shell__refine-mutations"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          marginBottom: '12px',
        }}
      >
        {PRESET_MUTATION_STYLES.map((m) => (
          <button
            key={m.id}
            type="button"
            className="stims-shell__refine-btn stims-shell__refine-btn--secondary"
            onClick={() => void handleApplyMutation(m.id)}
            disabled={state !== 'idle' || !currentSource}
            style={{ fontSize: '0.82rem', padding: '4px 8px' }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="stims-shell__refine-input">
        <label htmlFor="refine-instruction" className="stims-shell__sr-only">
          Describe how to change the preset
        </label>
        <textarea
          id="refine-instruction"
          className="stims-shell__refine-textarea"
          placeholder="e.g., make it more blue, add slow rotation, increase bass reactivity"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          disabled={state !== 'idle'}
        />
      </div>

      <div className="stims-shell__refine-actions">
        <button
          type="button"
          className="stims-shell__refine-btn"
          onClick={() => void handleRefine()}
          disabled={state !== 'idle' || !instruction.trim()}
        >
          {state === 'refining' ? 'Refining…' : 'Refine with AI'}
        </button>
        <button
          type="button"
          className="stims-shell__refine-btn stims-shell__refine-btn--secondary"
          onClick={() => void handleExplain()}
          disabled={state !== 'idle' || !currentSource}
        >
          {state === 'explaining' ? 'Reading…' : 'Explain'}
        </button>
      </div>

      {proposal ? (
        <section
          className="stims-shell__refine-proposal"
          aria-label={`${proposal.label}: proposed change`}
        >
          <p className="stims-shell__refine-proposal-head">
            {proposal.label} — review the change
          </p>
          <pre className="stims-shell__refine-diff">
            {proposalDiff.map((line, index) => (
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
                      ? '\u22EF '
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
              onClick={applyProposal}
            >
              Apply
            </button>
            <button
              type="button"
              className="stims-shell__refine-btn stims-shell__refine-btn--secondary"
              onClick={() => setProposal(null)}
            >
              Discard
            </button>
          </div>
        </section>
      ) : null}

      {response && (
        <div
          className="stims-shell__refine-response"
          role="status"
          aria-live="polite"
          style={{ marginTop: '12px', fontSize: '0.88rem', lineHeight: '1.4' }}
        >
          {response}
        </div>
      )}

      {analysis && (
        <div
          className="stims-shell__refine-analysis"
          style={{
            marginTop: '10px',
            padding: '10px',
            borderRadius: '6px',
            background: 'var(--stims-surface-subtle, rgba(255,255,255,0.05))',
            fontSize: '0.82rem',
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
            What the equations do
          </div>
          <div>
            • <b>Motion:</b> {analysis.motion.description}
          </div>
          <div>
            • <b>Color:</b> {analysis.colors.description}
          </div>
          <div>
            • <b>Audio:</b> {analysis.audioReactivity.description}
          </div>
          {analysis.tags.length > 0 && (
            <div style={{ marginTop: '6px' }}>
              • <b>Tags:</b> {analysis.tags.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
