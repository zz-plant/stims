import {
  analyzePresetMath,
  type PresetMathAnalysis,
} from 'milkdrop-toolchain/src/preset-math-analyzer.ts';
import { useCallback, useState } from 'react';
import {
  mutatePresetStyle,
  PRESET_MUTATION_STYLES,
  type PresetMutationStyle,
} from '../milkdrop/preset-mutations.ts';
import { useEngineSnapshot } from './engine-context.tsx';
import { ProposalReview, usePresetProposal } from './preset-proposal.tsx';
import { restyleLabel } from './preset-refine.ts';
import { useWorkspace } from './workspace-context.tsx';

export function RefinePanel() {
  const [instruction, setInstruction] = useState('');
  const [state, setState] = useState<'idle' | 'refining' | 'explaining'>(
    'idle',
  );
  const [analysis, setAnalysis] = useState<PresetMathAnalysis | null>(null);
  const { engine, ui } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const currentSource = engineSnapshot?.currentSource ?? '';
  const {
    proposal,
    response,
    setResponse,
    propose,
    apply,
    discard,
    describeChange,
  } = usePresetProposal({
    currentSource,
    applySource: (source) => engine.updateEditorSource(source),
    surface: 'other',
    aiUnavailableNote: 'The restyle buttons above still work.',
  });

  const handleApplyMutation = useCallback(
    async (style: PresetMutationStyle) => {
      if (!currentSource) return;
      setState('refining');
      const label = restyleLabel(style);
      setAnalysis(null);
      ui.setStatusMessage(`Applying ${label}…`);
      try {
        const mutatedSource = mutatePresetStyle(currentSource, style);
        propose(label, currentSource, mutatedSource, `Applied ${label}.`);
      } catch (err) {
        const error = err as Error;
        setResponse(`Could not apply ${label}: ${error.message}`);
      }
      // Cleanup after the catch rather than in a `finally` clause: React
      // Compiler cannot lower try/finally yet, and one unparsable function
      // skips the whole file. The catch swallows everything, so this runs on
      // both paths exactly as the finally did.
      setState('idle');
      ui.setStatusMessage(null);
    },
    [currentSource, propose, setResponse, ui],
  );

  const handleRefine = async () => {
    if (!instruction.trim() || !currentSource) return;
    setState('refining');
    setAnalysis(null);
    ui.setStatusMessage('Refining preset…');
    await describeChange(instruction.trim());
    setState('idle');
    ui.setStatusMessage(null);
  };

  const handleExplain = useCallback(async () => {
    if (!currentSource) return;
    setState('explaining');
    ui.setStatusMessage('Reading the equations…');
    // The remote attempt is an inner function so its `throw` (a non-ok
    // response becomes an error to trigger the local fallback) stays out of
    // the handler React Compiler parses — a throw inside try is not lowered
    // yet, and one unparsable function skips the whole file.
    const remoteExplain = async () => {
      // 1. Try remote model if configured
      const res = await fetch('/api/refine-preset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentSource,
          instruction: 'explain this preset',
        }),
      });
      if (!res.ok) throw new Error(`Server status ${res.status}`);
      const data = await res.json();
      setResponse(data.explanation || data.message || null);
    };
    try {
      await remoteExplain();
    } catch (err) {
      console.debug(
        'Remote explain failed, falling back to local AST analysis:',
        err,
      );
      // 2. Local fallback: a summary read from the equations themselves
      const mathAnalysis = analyzePresetMath(currentSource);
      setAnalysis(mathAnalysis);
      setResponse(
        `The AI service did not answer, so this comes from reading the equations in this browser. ${mathAnalysis.summary}`,
      );
    }
    // Cleanup after the catch rather than in a `finally` clause — the catch
    // is itself the recovery path, so this runs on both branches exactly as
    // the finally did, and the file stays React Compiler-parseable.
    setState('idle');
    ui.setStatusMessage(null);
  }, [currentSource, setResponse, ui]);

  return (
    <div className="stims-shell__refine-panel">
      <p className="stims-shell__meta-copy">
        Restyle the preset in one click, describe a change for the AI to make,
        or get a summary of what its equations do.
      </p>

      <div className="stims-shell__refine-mutations">
        {PRESET_MUTATION_STYLES.map((m) => (
          <button
            key={m.id}
            type="button"
            className="stims-shell__refine-btn stims-shell__refine-btn--secondary stims-shell__refine-btn--chip"
            onClick={() => void handleApplyMutation(m.id)}
            disabled={state !== 'idle' || !currentSource}
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
          onKeyDown={(e) => {
            if (
              (e.metaKey || e.ctrlKey) &&
              e.key === 'Enter' &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void handleRefine();
            }
          }}
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
          {state === 'explaining' ? 'Reading…' : 'Explain with AI'}
        </button>
      </div>

      {proposal ? (
        <ProposalReview
          proposal={proposal}
          onApply={apply}
          onDiscard={discard}
        />
      ) : null}

      {response && (
        <div
          className="stims-shell__refine-response"
          role="status"
          aria-live="polite"
        >
          {response}
        </div>
      )}

      {analysis && (
        <div className="stims-shell__refine-analysis">
          <div className="stims-shell__refine-analysis-title">
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
            <div className="stims-shell__refine-analysis-tags">
              • <b>Tags:</b> {analysis.tags.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
