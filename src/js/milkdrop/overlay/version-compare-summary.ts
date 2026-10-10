/**
 * Dataflow-aware change summary for the History tab's version compare.
 *
 * The line diff answers "what did the text do"; this answers "what did the
 * preset's relationship with the music do" — "zoom stopped listening to
 * bass" style lines derived from the audio-reach sets of the two sources
 * (the same static dataflow the editor's per-control chips and the e2e
 * readings use: analyzePresetDataflow, controlAudio, drawnPartAudio).
 *
 * Pure (compile → analyse → diff) so it is unit-testable without the DOM.
 * Compile failures — a saved version that no longer parses — return no
 * lines rather than blocking the diff it annotates; the diff itself is
 * always textual and always shows.
 */

import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import {
  analyzePresetDataflow,
  controlAudio,
  drawnPartAudio,
} from 'milkdrop-toolchain/src/preset-dataflow.ts';

/** Lines shown at once; the rest fold into one "and N more". */
export const MAX_AUDIO_REACH_LINES = 6;

/**
 * The built-in controls the summary watches: the motion controls whose
 * audio-reach a listener can actually hear change. Fixed list, so the
 * summary is bounded and its wording stable.
 */
const CONTROL_KEYS = [
  'zoom',
  'warp',
  'rot',
  'cx',
  'cy',
  'dx',
  'dy',
  'sx',
  'sy',
] as const;

type Reach = { controls: Map<string, string[]>; parts: Map<string, string[]> };

/** One source's audio-reach sets, or null when it cannot be compiled. */
function audioReach(source: string): Reach | null {
  try {
    const compiled = compileMilkdropPresetSource(source);
    if (compiled.diagnostics.some((d) => d.severity === 'error')) return null;
    const dataflow = analyzePresetDataflow(compiled.ir);
    const controls = new Map<string, string[]>();
    for (const key of CONTROL_KEYS) {
      const audio = controlAudio(dataflow, key);
      // null (no program writes it) and [] (written, nothing reaches it)
      // both mean "not listening"; keep one spelling so the diff does not
      // report a change between them.
      controls.set(key, audio ?? []);
    }
    return { controls, parts: drawnPartAudio(compiled.ir, dataflow) };
  } catch {
    return null;
  }
}

function listSignals(signals: string[]): string {
  return signals.join(', ');
}

function joinAnd(list: string[]): string {
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * Plain-English changes in how two sources listen to the music, first side
 * ("before") → second side ("after"). Empty when both compile and nothing
 * changed, and when either side cannot be analysed.
 */
export function summarizeAudioReach(before: string, after: string): string[] {
  const reachBefore = audioReach(before);
  const reachAfter = audioReach(after);
  if (!reachBefore || !reachAfter) return [];

  const lines: string[] = [];
  for (const key of CONTROL_KEYS) {
    const was = reachBefore.controls.get(key) ?? [];
    const now = reachAfter.controls.get(key) ?? [];
    const stopped = was.filter((signal) => !now.includes(signal));
    const started = now.filter((signal) => !was.includes(signal));
    if (stopped.length > 0) {
      lines.push(`${key} stopped listening to ${listSignals(stopped)}`);
    }
    if (started.length > 0) {
      lines.push(`${key} started listening to ${listSignals(started)}`);
    }
  }

  const partNames = [
    ...new Set([...reachBefore.parts.keys(), ...reachAfter.parts.keys()]),
  ].sort();
  for (const part of partNames) {
    const was = reachBefore.parts.get(part);
    const now = reachAfter.parts.get(part);
    if (was === undefined || now === undefined) {
      const listens =
        now && now.length > 0 ? `, listening to ${listSignals(now)}` : '';
      lines.push(
        was === undefined
          ? `${part} started drawing${listens}`
          : `${part} stopped drawing`,
      );
      continue;
    }
    const stopped = was.filter((signal) => !now.includes(signal));
    const started = now.filter((signal) => !was.includes(signal));
    if (stopped.length > 0) {
      lines.push(`${part} stopped listening to ${listSignals(stopped)}`);
    }
    if (started.length > 0) {
      lines.push(`${part} started listening to ${listSignals(started)}`);
    }
  }

  if (lines.length <= MAX_AUDIO_REACH_LINES) return lines;
  return [
    ...lines.slice(0, MAX_AUDIO_REACH_LINES),
    `and ${lines.length - MAX_AUDIO_REACH_LINES} more`,
  ];
}

/** Joins the summary lines into one sentence. */
export function formatAudioReachSummary(lines: readonly string[]): string {
  return joinAnd([...lines]);
}
