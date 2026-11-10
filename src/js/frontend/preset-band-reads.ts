/**
 * Which of the three audio bands a preset's drawn output follows.
 *
 * The swatch graph (SwatchGraph.tsx) lights the bands a preset reads, the
 * way a gel swatch prints the part of the spectrum its filter passes. The
 * reading is the editor's own: `analyzePresetDataflow` on the compile on
 * stage, then every signal that reaches something drawn, a built-in control
 * (`zoom`, `wave_r`, …), the per-pixel mesh, or an enabled custom wave or
 * shape. A value computed from the bass and never drawn does not count.
 *
 * Signals that are not one band (`vol`, `rms`, a wave's `value1` samples)
 * light no band: they follow the whole mix, and the graph would lie if it
 * picked one.
 */
import { DEFAULT_MILKDROP_STATE } from 'milkdrop-toolchain/src/compiler.ts';
import type { MilkdropPresetIR } from 'milkdrop-toolchain/src/compiler-types.ts';
import {
  analyzePresetDataflow,
  controlAudio,
  drawnPartAudio,
} from 'milkdrop-toolchain/src/preset-dataflow.ts';

export type BandReads = { bass: boolean; mid: boolean; treble: boolean };

export const NO_BAND_READS: BandReads = Object.freeze({
  bass: false,
  mid: false,
  treble: false,
});

const BAND_OF_SIGNAL: Record<string, keyof BandReads> = {
  bass: 'bass',
  bass_att: 'bass',
  bassatt: 'bass',
  mid: 'mid',
  med: 'mid',
  mids: 'mid',
  mid_att: 'mid',
  med_att: 'mid',
  mids_att: 'mid',
  midatt: 'mid',
  midsatt: 'mid',
  treb: 'treble',
  treble: 'treble',
  treb_att: 'treble',
  treble_att: 'treble',
  trebleatt: 'treble',
};

export function bandReadsOf(ir: MilkdropPresetIR): BandReads {
  const dataflow = analyzePresetDataflow(ir);
  const signals = new Set<string>();
  for (const audio of drawnPartAudio(ir, dataflow).values()) {
    for (const signal of audio) signals.add(signal);
  }
  for (const key of Object.keys(DEFAULT_MILKDROP_STATE)) {
    for (const signal of controlAudio(dataflow, key) ?? []) signals.add(signal);
  }
  const reads: BandReads = { bass: false, mid: false, treble: false };
  for (const signal of signals) {
    const band = BAND_OF_SIGNAL[signal.toLowerCase()];
    if (band) reads[band] = true;
  }
  return reads;
}

const cache = new WeakMap<MilkdropPresetIR, BandReads>();

/** `bandReadsOf`, memoised per compile so a re-render costs nothing. */
export function cachedBandReads(ir: MilkdropPresetIR | null | undefined) {
  if (!ir) return NO_BAND_READS;
  let reads = cache.get(ir);
  if (!reads) {
    try {
      reads = bandReadsOf(ir);
    } catch {
      reads = NO_BAND_READS;
    }
    cache.set(ir, reads);
  }
  return reads;
}
