import { useCallback, useRef, useState } from 'react';
import { useEngine } from '../engine-context.tsx';
import { useWorkspace } from '../workspace-context.tsx';

export type GenerationState = 'idle' | 'generating' | 'failed' | 'succeeded';

export function useGeneratePreset() {
  const engine = useEngine();
  const { ui } = useWorkspace();
  const { setStatusMessage } = ui;
  const [state, setState] = useState<GenerationState>('idle');
  const [description, setDescription] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(
    async (text?: string) => {
      const query = text?.trim() || description.trim();
      if (!query) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState('generating');
      setStatusMessage(`Generating: "${query}"...`);

      try {
        const response = await fetch('/api/generate-preset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: query,
            complexity: 'moderate',
          }),
          signal: controller.signal,
        });

        if (!response.ok) throw new Error(`Server error: ${response.status}`);
        const data = await response.json();

        if (data.milkSource) {
          await engine.updateEditorSource(data.milkSource);
          setState('succeeded');
          setStatusMessage(`Generated: ${data.title || 'New Preset'}`);
          setDescription('');
        } else {
          throw new Error('No source returned from AI.');
        }
      } catch (err) {
        const error = err as Error & { name?: string };
        if (error.name === 'AbortError') return;
        setState('failed');
        setStatusMessage(`Generation failed: ${error.message}`);
        console.error('Generation error:', error);
      } finally {
        if (!controller.signal.aborted) setState('idle');
      }
    },
    [description, engine, setStatusMessage],
  );

  return {
    state,
    description,
    setDescription,
    generate,
    abort: () => abortRef.current?.abort(),
  };
}
