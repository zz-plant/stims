import { useCallback, useState } from 'react';
import {
  analyzePresetMath,
  type PresetMathAnalysis,
} from '../milkdrop/preset-math-analyzer.ts';
import {
  mutatePresetStyle,
  type PresetMutationStyle,
} from '../milkdrop/preset-mutations.ts';
import { useEngineSnapshot } from './engine-context.tsx';
import { useWorkspace } from './workspace-context.tsx';

const MUTATION_STYLES: Array<{
  id: PresetMutationStyle;
  label: string;
  emoji: string;
}> = [
  { id: 'cyberpunk', label: 'Cyberpunk Neon', emoji: '⚡' },
  { id: 'hyperspace', label: 'Hyperspace Warp', emoji: '🚀' },
  { id: 'ambient-glow', label: 'Ambient Glow', emoji: '🌿' },
  { id: 'kaleidoscope', label: 'Kaleidoscope', emoji: '🔮' },
  { id: 'bass-surge', label: 'Bass Surge', emoji: '💥' },
];

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
      ui.setStatusMessage(`Applying ${style} mutation…`);
      try {
        const mutatedSource = mutatePresetStyle(currentSource, style);
        await engine.updateEditorSource(mutatedSource);
        setResponse(`Applied instant ${style} style transformation.`);
        setAnalysis(null);
      } catch (err) {
        const error = err as Error;
        setResponse(`Mutation error: ${error.message}`);
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
        setResponse(`Refined: ${data.title || 'New Preset'}`);
        setAnalysis(null);
      } else {
        throw new Error('No source returned');
      }
    } catch (err) {
      const error = err as Error;
      // Graceful offline fallback: if edge API is not configured, apply keyword heuristics
      const lower = instruction.toLowerCase();
      if (
        lower.includes('blue') ||
        lower.includes('neon') ||
        lower.includes('cyan')
      ) {
        const mutated = mutatePresetStyle(currentSource, 'cyberpunk');
        await engine.updateEditorSource(mutated);
        setResponse('Offline Mode: Applied neon color mutation.');
      } else if (
        lower.includes('warp') ||
        lower.includes('fast') ||
        lower.includes('speed')
      ) {
        const mutated = mutatePresetStyle(currentSource, 'hyperspace');
        await engine.updateEditorSource(mutated);
        setResponse('Offline Mode: Applied hyperspace motion mutation.');
      } else if (lower.includes('bass') || lower.includes('beat')) {
        const mutated = mutatePresetStyle(currentSource, 'bass-surge');
        await engine.updateEditorSource(mutated);
        setResponse('Offline Mode: Applied bass reactivity mutation.');
      } else {
        setResponse(
          `API not available: ${error.message}. Try the instant mutation buttons above!`,
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
    ui.setStatusMessage('Analyzing mathematical AST…');
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
      // 2. Instant client-side mathematical analysis fallback
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
        Instant AI style mutations, AST equation breakdown, or natural language
        refinement.
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
        {MUTATION_STYLES.map((m) => (
          <button
            key={m.id}
            type="button"
            className="stims-shell__refine-btn stims-shell__refine-btn--secondary"
            onClick={() => void handleApplyMutation(m.id)}
            disabled={state !== 'idle' || !currentSource}
            style={{ fontSize: '0.82rem', padding: '4px 8px' }}
          >
            <span>{m.emoji}</span> {m.label}
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
          {state === 'explaining' ? 'Analyzing…' : 'Explain Math'}
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
            📐 Equation Breakdown:
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
