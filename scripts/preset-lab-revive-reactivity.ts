/**
 * Preset lab — revive reactivity for audio-inert presets (#1675).
 *
 * Audits a preset's static dataflow (preset-dataflow.ts) for inert canonical
 * controls and unconnected q registers, then proposes a minimal audio-coupling
 * patch. The patch is printed by default; --write applies it to the catalog
 * file.
 *
 *   bun run lab:revive-reactivity -- --preset <id>
 *   bun run lab:revive-reactivity -- --preset <id> --write
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import {
  analyzePresetDataflow,
  type PresetDataflow,
} from 'milkdrop-toolchain/src/preset-dataflow.ts';
import { applyRecipe } from '../src/js/milkdrop/cookbook.ts';
import { loadPresetSource } from './preset-lab-reactivity.ts';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export type InertiaReport = {
  inertControls: string[];
  audioInert: boolean;
  unconnectedQ: number[];
  clockworkControls: string[];
};

const CANONICAL = [
  'zoom',
  'rot',
  'warp',
  'cx',
  'cy',
  'dx',
  'dy',
  'sx',
  'sy',
] as const;

export function detectInertia(dataflow: PresetDataflow): InertiaReport {
  const inertControls: string[] = [];
  const clockworkControls: string[] = [];
  for (const name of CANONICAL) {
    const v = dataflow.variables.get(name);
    if (!v) continue;
    if (v.kind === 'constant' || v.kind === 'clockwork') {
      inertControls.push(name);
    }
    if (v.kind === 'clockwork') clockworkControls.push(name);
  }
  // Audio-inert: no per-pixel control is audio-driven.
  const perPixelAudio = dataflow.drawnAudio.perPixel;
  const audioInert = !perPixelAudio || perPixelAudio.length === 0;

  // Unconnected q registers: qN assigned an audio value but never read as
  // audio in per-pixel/wave outputs. We approximate by scanning variables
  // named q1..q32 whose kind is audio but which don't appear in drawnAudio.
  const drawn = new Set<string>([
    ...dataflow.drawnAudio.perPixel,
    ...dataflow.drawnAudio.waves.flat(),
    ...dataflow.drawnAudio.shapes.flat(),
  ]);
  const unconnectedQ: number[] = [];
  for (let i = 1; i <= 32; i += 1) {
    const q = `q${i}`;
    const v = dataflow.variables.get(q);
    if (v && v.kind === 'audio' && !drawn.has(q)) {
      unconnectedQ.push(i);
    }
  }

  return { inertControls, audioInert, unconnectedQ, clockworkControls };
}

export function proposePatch(
  source: string,
  report: InertiaReport,
): { patch: string; source: string } | null {
  // Minimal coupling: nudge zoom from bass_att if zoom is inert.
  if (!report.inertControls.includes('zoom')) return null;
  const recipe = { code: { perFrame: ['zoom = zoom + 0.05*(bass_att - 1);'] } };
  const result = applyRecipe(source, recipe);
  return {
    patch: 'per_frame: zoom = zoom + 0.05*(bass_att - 1);',
    source: result.source,
  };
}

function printPreset(presetId: string) {
  const { id, raw } = loadPresetSource(repoRoot, { presetId });
  const ir = compileMilkdropPresetSource(raw, { id }).ir;
  const dataflow = analyzePresetDataflow(ir);
  const report = detectInertia(dataflow);
  console.log(`Preset: ${id}`);
  console.log(`Audio-inert: ${report.audioInert}`);
  console.log(`Inert controls: ${report.inertControls.join(', ') || '(none)'}`);
  console.log(
    `Clockwork controls: ${report.clockworkControls.join(', ') || '(none)'}`,
  );
  console.log(`Unconnected q: ${report.unconnectedQ.join(', ') || '(none)'}`);
  console.log(
    `Per-pixel audio: ${dataflow.drawnAudio.perPixel.join(', ') || '(none)'}`,
  );
  const proposal = proposePatch(raw, report);
  if (proposal) {
    console.log(`Proposed patch: ${proposal.patch}`);
  } else {
    console.log('No patch proposed (zoom not inert).');
  }
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const preset = get('--preset');
  const write = args.includes('--write');
  if (!preset) {
    throw new Error(
      'Usage: bun run lab:revive-reactivity -- --preset <id> [--write]',
    );
  }
  const { id, raw, filePath } = loadPresetSource(repoRoot, {
    presetId: preset,
  });
  const ir = compileMilkdropPresetSource(raw, { id }).ir;
  const dataflow = analyzePresetDataflow(ir);
  const report = detectInertia(dataflow);
  printPreset(preset);
  if (write) {
    const proposal = proposePatch(raw, report);
    if (!proposal) {
      console.log('Nothing to write.');
      return;
    }
    const target =
      filePath ??
      path.join(repoRoot, 'public', 'milkdrop-presets', `${id}.milk`);
    fs.writeFileSync(target, proposal.source, 'latin1');
    console.log(`Wrote patched preset to ${target}`);
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
