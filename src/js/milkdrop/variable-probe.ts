/**
 * Live feed of a preset's equation variables for the editor's Inspect tab.
 *
 * The runtime already carries every variable on each frame state, but only
 * published it to the agent debug snapshot — invisible to a human author.
 * This is the opt-in path: the render loop calls `publishVariables` every
 * frame (a no-op unless someone is listening), and the Inspect tab throttles
 * on its side. Kept dependency-free so the editor chunk can import it without
 * pulling in the runtime.
 */
type AudioLevels = Readonly<
  Record<'bass' | 'mid' | 'treb' | 'bass_att' | 'mid_att' | 'treb_att', number>
>;

/** A frame's variables, and the audio levels it was rendered with. */
type VariableListener = (
  variables: Readonly<Record<string, number>>,
  levels?: AudioLevels,
) => void;

const listeners = new Set<VariableListener>();

export function subscribeVariables(listener: VariableListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function hasVariableListeners(): boolean {
  return listeners.size > 0;
}

export function publishVariables(
  variables: Readonly<Record<string, number>>,
  levels?: AudioLevels,
) {
  if (listeners.size === 0) return;
  for (const listener of listeners) listener(variables, levels);
}
