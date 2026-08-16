import { useCallback, useState } from 'react';
import { useEngineSnapshot } from './engine-context.tsx';
import { useWorkspace } from './workspace-context.tsx';

export function RefinePanel() {
  const [instruction, setInstruction] = useState('');
  const [state, setState] = useState<'idle' | 'refining' | 'explaining'>(
    'idle',
  );
  const [response, setResponse] = useState<string | null>(null);
  const { engine, ui } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const currentSource = engineSnapshot?.currentSource ?? '';

  const handleRefine = useCallback(async () => {
    if (!instruction.trim()) return;
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
      } else {
        throw new Error('No source returned');
      }
    } catch (err) {
      const error = err as Error;
      setResponse(`Error: ${error.message}`);
    } finally {
      setState('idle');
      ui.setStatusMessage(null);
    }
  }, [currentSource, engine, instruction, ui]);

  const handleExplain = useCallback(async () => {
    if (!instruction.trim()) return;
    setState('explaining');
    ui.setStatusMessage('Analyzing preset…');
    try {
      const res = await fetch('/api/refine-preset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentSource,
          instruction: 'explain this preset',
        }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      setResponse(
        data.explanation || data.message || 'No explanation available.',
      );
    } catch (err) {
      const error = err as Error;
      setResponse(`Error: ${error.message}`);
    } finally {
      setState('idle');
      ui.setStatusMessage(null);
    }
  }, [currentSource, instruction, ui]);

  return (
    <div className="stims-shell__refine-panel">
      <p className="stims-shell__meta-copy">
        Describe a change and AI rewrites the current preset to match.
      </p>
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
          onClick={handleRefine}
          disabled={state !== 'idle' || !instruction.trim()}
        >
          {state === 'refining' ? 'Refining…' : 'Refine'}
        </button>
        <button
          type="button"
          className="stims-shell__refine-btn stims-shell__refine-btn--secondary"
          onClick={handleExplain}
          disabled={state !== 'idle' || !instruction.trim()}
        >
          {state === 'explaining' ? 'Explaining…' : 'Explain'}
        </button>
      </div>
      {response && (
        <div
          className="stims-shell__refine-response"
          role="status"
          aria-live="polite"
        >
          {response}
        </div>
      )}
    </div>
  );
}
