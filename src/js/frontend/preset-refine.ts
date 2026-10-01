/**
 * Turns a described change ("more blue", "faster motion") into new preset
 * source. The AI refine endpoint does the real work. Without it (the dev
 * server, or AI not configured) a few keywords map onto the matching one-click
 * restyle, and an instruction that matches none is reported, not guessed at.
 *
 * Shared by the Refine panel and the iframe bridge's `toil:apply_tweak`, so
 * the same words make the same edit from either surface.
 */
import {
  mutatePresetStyle,
  PRESET_MUTATION_STYLES,
  type PresetMutationStyle,
} from '../milkdrop/preset-mutations.ts';

export type PresetRefinement =
  | { method: 'ai'; milkSource: string; title: string | null }
  | {
      method: 'restyle';
      style: PresetMutationStyle;
      label: string;
      milkSource: string;
      /** Why the AI path was not used. */
      aiError: string;
    }
  | { method: 'none'; aiError: string };

const KEYWORD_RESTYLES: ReadonlyArray<{
  keywords: readonly string[];
  style: PresetMutationStyle;
}> = [
  { keywords: ['blue', 'neon', 'cyan'], style: 'cyberpunk' },
  { keywords: ['warp', 'fast', 'speed'], style: 'hyperspace' },
  { keywords: ['bass', 'beat'], style: 'bass-surge' },
];

/** Every word the offline fallback recognises, for "try one of" messages. */
export const REFINE_FALLBACK_KEYWORDS: readonly string[] =
  KEYWORD_RESTYLES.flatMap((entry) => entry.keywords);

export function restyleLabel(style: PresetMutationStyle): string {
  return PRESET_MUTATION_STYLES.find((m) => m.id === style)?.label ?? style;
}

async function requestAiRefinement(
  currentSource: string,
  instruction: string,
): Promise<{ milkSource: string; title: string | null }> {
  const res = await fetch('/api/refine-preset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentSource, instruction }),
  });
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const data = (await res.json()) as { milkSource?: unknown; title?: unknown };
  if (typeof data.milkSource !== 'string' || !data.milkSource) {
    throw new Error('No source returned');
  }
  return {
    milkSource: data.milkSource,
    title: typeof data.title === 'string' && data.title ? data.title : null,
  };
}

export async function refinePresetSource(
  currentSource: string,
  instruction: string,
): Promise<PresetRefinement> {
  try {
    const refined = await requestAiRefinement(currentSource, instruction);
    return { method: 'ai', ...refined };
  } catch (error) {
    const aiError = error instanceof Error ? error.message : String(error);
    const lower = instruction.toLowerCase();
    const match = KEYWORD_RESTYLES.find((entry) =>
      entry.keywords.some((keyword) => lower.includes(keyword)),
    );
    if (!match) return { method: 'none', aiError };
    return {
      method: 'restyle',
      style: match.style,
      label: restyleLabel(match.style),
      milkSource: mutatePresetStyle(currentSource, match.style),
      aiError,
    };
  }
}
