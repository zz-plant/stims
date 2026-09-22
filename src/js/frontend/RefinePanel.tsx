import { useCallback, useState } from 'react';
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
import { useWorkspace } from './workspace-context.tsx';

function restyleLabel(style: PresetMutationStyle) {
  return PRESET_MUTATION_STYLES.find((m) => m.id === style)?.label ?? style;
}

export function RefinePanel() {
  const [instruction, setInstruction] = useState('');
  const [state, setState] = useState<'idle' | 'refining' | 'explaining'>(
    'idle',
  );
  const [response, setResponse] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<PresetMathAnalysis | null>(null);
  const { engine, ui } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const currentSource = engineSnapshot?.currentSource ?? '';

  const handleApplyMutation = useCallback(
    async (style: PresetMutationStyle) => {
      if (!currentSource) return;
      setState('refining');
      const label = restyleLabel(style);
      ui.setStatusMessage(`Applying ${label}…`);
      try {
        const mutatedSource = mutatePresetStyle(currentSource, style);
        await engine.updateEditorSource(mutatedSource);
        setResponse(`Applied ${label}.`);
        setAnalysis(null);
      } catch (err) {
        const error = err as Error;
        setResponse(`Could not apply ${label}: ${error.message}`);
      } finally {
        setState('idle');
        ui.setStatusMessage(null);
      }
    },
    [currentSource, engine, ui],
  );

  const handleRefine = useCallback(async () => {
    if (!instruction.trim() || !currentSource) return;
    setState('refining');
    ui.setStatusMessage('Refining preset…');
    try {
      const res = await fetch('/api/refine-preset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentSource,
          instruction: instruction.trim(),
        }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      if (data.milkSource) {
        await engine.updateEditorSource(data.milkSource);
        setResponse(`Refined: ${data.title || 'untitled preset'}`);
        setAnalysis(null);
      } else {
        throw new Error('No source returned');
      }
    } catch (err) {
      const error = err as Error;
      // Without the refine API (dev server, or AI not configured), map a few
      // keywords onto the matching one-click restyle.
      const lower = instruction.toLowerCase();
      if (
        lower.includes('blue') ||
        lower.includes('neon') ||
        lower.includes('cyan')
      ) {
        const mutated = mutatePresetStyle(currentSource, 'cyberpunk');
        await engine.updateEditorSource(mutated);
        setResponse('AI is unavailable, so the Neon restyle was applied.');
      } else if (
        lower.includes('warp') ||
        lower.includes('fast') ||
        lower.includes('speed')
      ) {
        const mutated = mutatePresetStyle(currentSource, 'hyperspace');
        await engine.updateEditorSource(mutated);
        setResponse(
          'AI is unavailable, so the Zoom tunnel restyle was applied.',
        );
      } else if (lower.includes('bass') || lower.includes('beat')) {
        const mutated = mutatePresetStyle(currentSource, 'bass-surge');
        await engine.updateEditorSource(mutated);
        setResponse(
          'AI is unavailable, so the Bass pulse restyle was applied.',
        );
      } else {
        setResponse(
          `AI is unavailable (${error.message}). The restyle buttons above still work.`,
        );
      }
    } finally {
      setState('idle');
      ui.setStatusMessage(null);
    }
  }, [currentSource, engine, instruction, ui]);

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
