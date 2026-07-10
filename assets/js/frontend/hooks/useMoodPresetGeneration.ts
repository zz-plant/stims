import { useCallback, useRef, useState } from 'react';

export type MoodPreset = { label: string; desc: string; icon: string };
export type MoodGenerationState =
  | 'idle'
  | 'generating'
  | 'failed'
  | 'succeeded'
  | 'cancelled';

export function useMoodPresetGeneration({
  offline = false,
  setStatusMessage,
  openEditor,
}: {
  offline?: boolean;
  setStatusMessage: (message: string | null) => void;
  openEditor: () => void;
}) {
  const [state, setState] = useState<MoodGenerationState>('idle');
  const [generatingMood, setGeneratingMood] = useState<string | null>(null);
  const [lastMood, setLastMood] = useState<MoodPreset | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState('cancelled');
    setGeneratingMood(null);
    setStatusMessage('Preset generation cancelled.');
  }, [setStatusMessage]);

  const generate = useCallback(
    (mood: MoodPreset) => {
      if (offline) {
        setState('failed');
        setStatusMessage('AI preset generation needs a network connection.');
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLastMood(mood);
      setState('generating');
      setGeneratingMood(mood.label);
      setStatusMessage(`Generating a ${mood.label} preset…`);
      fetch('/api/generate-preset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: `${mood.desc} ${mood.label.toLowerCase()} visualizer preset`,
          complexity: 'moderate',
        }),
        signal: controller.signal,
      })
        .then((r) => {
          if (!r.ok) throw new Error(`Server returned ${r.status}`);
          return r.json();
        })
        .then((data) => {
          if (controller.signal.aborted) return;
          if (data.milkSource) {
            document.dispatchEvent(
              new CustomEvent('stims:editor:source-change', {
                detail: {
                  source: data.milkSource,
                  title: data.title || mood.label,
                },
              }),
            );
            setState('succeeded');
            setStatusMessage(`Generated ${mood.label} preset. Opening editor.`);
            openEditor();
          } else {
            throw new Error('No preset source returned.');
          }
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setState('failed');
          setStatusMessage('Preset generation failed. Try again.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setGeneratingMood(null);
        });
    },
    [offline, openEditor, setStatusMessage],
  );

  const retry = useCallback(() => {
    if (lastMood) generate(lastMood);
  }, [generate, lastMood]);

  return {
    state,
    generatingMood,
    generate,
    cancel,
    retry,
    canRetry: Boolean(lastMood) && state === 'failed',
  };
}
