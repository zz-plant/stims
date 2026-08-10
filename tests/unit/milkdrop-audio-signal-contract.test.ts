/**
 * Guards the *scale* of the audio signal the runtime hands to presets.
 *
 * MilkDrop preset code is written against relative band levels where 1.0 means
 * "as loud as this track usually is" — so the catalog is full of thresholds
 * like `above(bass, 1)` and `bass_thresh = 1.3`. If the runtime ever goes back
 * to feeding raw 0..1 spectrum averages (which peak around 0.6), every one of
 * those comparisons silently becomes dead code: presets still compile, still
 * render, and still pass every other test — they just stop reacting.
 *
 * That is exactly the failure these tests exist to catch. Rather than hardcode
 * an expected range, they read the thresholds the bundled catalog actually
 * asks for and assert the runtime can reach them.
 */

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fillScenarioSpectrum,
  fillScenarioWaveform,
  PRESET_LAB_SPECTRUM_BINS,
  type PresetLabScenario,
} from '../../scripts/preset-lab-metrics.ts';
import { createMilkdropSignalTracker } from '../../src/js/milkdrop/runtime-signals.ts';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const presetRoot = path.join(repoRoot, 'public', 'milkdrop-presets');

const FPS = 60;
const FRAME_MS = 1000 / FPS;
/** Frames discarded before measuring, so the long-term average has settled. */
const WARMUP_FRAMES = 240;
const SAMPLE_FRAMES = 660;

type Band = 'bass' | 'mid' | 'treb';
type BandPeaks = Record<Band, number>;
type AttPeaks = Record<'bass_att' | 'mid_att' | 'treb_att', number>;

/**
 * `above(bass, 1.3)` and friends — the literal thresholds preset authors
 * compare band levels against. Variable thresholds (`above(bass, bassthresh)`)
 * are skipped: their value is only known at runtime, and the literals alone
 * are a large enough sample to pin the scale.
 */
const THRESHOLD_PATTERN =
  /above\s*\(\s*(bass|mid|treb)(?:_att)?\s*,\s*([0-9]*\.?[0-9]+)\s*\)/gi;

type ThresholdDemand = { band: Band; threshold: number };

function collectCatalogThresholds(): ThresholdDemand[] {
  const demands: ThresholdDemand[] = [];
  const files = fs
    .readdirSync(presetRoot, { recursive: true })
    .map(String)
    .filter((entry) => entry.toLowerCase().endsWith('.milk'));

  for (const file of files) {
    // Preset files are latin1: they predate UTF-8 and carry high-byte bytes in
    // their titles that would otherwise decode to replacement characters.
    const raw = fs.readFileSync(path.join(presetRoot, file), 'latin1');
    for (const match of raw.matchAll(THRESHOLD_PATTERN)) {
      const threshold = Number(match[2]);
      if (Number.isFinite(threshold)) {
        demands.push({
          band: match[1].toLowerCase() as Band,
          threshold,
        });
      }
    }
  }
  return demands;
}

/** Peak band level the runtime delivers under one synthetic scenario. */
function measureBandPeaks(scenario: PresetLabScenario): BandPeaks & AttPeaks {
  const tracker = createMilkdropSignalTracker();
  const spectrum = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
  const waveform = new Uint8Array(128);
  const peaks: BandPeaks & AttPeaks = {
    bass: 0,
    mid: 0,
    treb: 0,
    bass_att: 0,
    mid_att: 0,
    treb_att: 0,
  };

  for (let frame = 0; frame < WARMUP_FRAMES + SAMPLE_FRAMES; frame += 1) {
    const timeMs = frame * FRAME_MS;
    fillScenarioSpectrum(spectrum, scenario, timeMs);
    fillScenarioWaveform(waveform, scenario, timeMs);
    const signals = tracker.update({
      time: timeMs / 1000,
      deltaMs: FRAME_MS,
      analyser: null,
      frequencyData: spectrum,
      waveformData: waveform,
    });
    if (frame < WARMUP_FRAMES) continue;
    peaks.bass = Math.max(peaks.bass, signals.bass);
    peaks.mid = Math.max(peaks.mid, signals.mid);
    peaks.treb = Math.max(peaks.treb, signals.treb);
    peaks.bass_att = Math.max(peaks.bass_att, signals.bass_att);
    peaks.mid_att = Math.max(peaks.mid_att, signals.mid_att);
    peaks.treb_att = Math.max(peaks.treb_att, signals.treb_att);
  }
  return peaks;
}

describe('milkdrop audio signal contract', () => {
  test('reaches the band thresholds the bundled catalog actually asks for', () => {
    const demands = collectCatalogThresholds();
    // Sanity-check the scraper itself: if the catalog moves or the pattern
    // stops matching, an empty demand list would make the assertion vacuous.
    expect(demands.length).toBeGreaterThan(200);

    const peaks = measureBandPeaks('full-mix');
    const reachable = demands.filter(
      (demand) => peaks[demand.band] >= demand.threshold,
    );
    const ratio = reachable.length / demands.length;

    // Measured at 93% once bands are on MilkDrop's relative scale, and at 17%
    // when they were raw 0..1 spectrum averages. The floor sits well below the
    // former and far above the latter, so ordinary tuning drift passes and a
    // rescale fails loudly. The shortfall is the handful of deliberate
    // never-fire guards preset authors write, like `above(bass, 9.5)`.
    if (ratio <= 0.85) {
      // Peaks are what a reader needs to diagnose this, and a bare ratio
      // comparison would not show them.
      console.error(
        `catalog thresholds reachable: ${reachable.length}/${demands.length} ` +
          `(${(ratio * 100).toFixed(1)}%); peak band levels: ` +
          `bass=${peaks.bass.toFixed(2)} mid=${peaks.mid.toFixed(2)} treb=${peaks.treb.toFixed(2)}`,
      );
    }
    expect(ratio).toBeGreaterThan(0.85);
  });

  test('crosses 1.0 on a beat, which is the single most common threshold', () => {
    const peaks = measureBandPeaks('bass-pulse');
    // `above(bass, 1)` appears ~146 times in the catalog — more than any other
    // audio comparison. A bass pulse that cannot cross it means no preset
    // using the idiom will ever fire.
    expect(peaks.bass).toBeGreaterThan(1);
  });

  test('attenuated bands also cross 1.0 on a beat', () => {
    // `bass_att` is the damped band, not a windowed average: classic presets
    // (Geiss - Happy Drops among the bundled ones) warp on `max(bass_att-1,0)`,
    // which is dead code unless the damped signal still tops 1.0 on pulses.
    const peaks = measureBandPeaks('bass-pulse');
    expect(peaks.bass_att).toBeGreaterThan(1);

    const fullMix = measureBandPeaks('full-mix');
    expect(fullMix.mid_att).toBeGreaterThan(1);
    expect(fullMix.treb_att).toBeGreaterThan(1);
  });

  test('settles near 1.0 through a steady passage rather than pinning high or low', () => {
    const tracker = createMilkdropSignalTracker();
    const spectrum = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
    const waveform = new Uint8Array(128);
    // A constant spectrum: the relative scale should read this as "typical",
    // whatever its absolute magnitude, because it *is* the track's average.
    spectrum.fill(120);
    waveform.fill(128);

    let signals = tracker.update({
      time: 0,
      deltaMs: FRAME_MS,
      analyser: null,
      frequencyData: spectrum,
      waveformData: waveform,
    });
    for (let frame = 1; frame < 600; frame += 1) {
      signals = tracker.update({
        time: (frame * FRAME_MS) / 1000,
        deltaMs: FRAME_MS,
        analyser: null,
        frequencyData: spectrum,
        waveformData: waveform,
      });
    }

    for (const value of [signals.bass, signals.mid, signals.treb]) {
      expect(value).toBeCloseTo(1, 1);
    }
  });

  test('keeps every band finite and bounded, including through silence', () => {
    const tracker = createMilkdropSignalTracker();
    const spectrum = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
    const waveform = new Uint8Array(128);

    for (let frame = 0; frame < 600; frame += 1) {
      const timeMs = frame * FRAME_MS;
      // Half a run of music, then silence: dividing by a long-term average
      // that has decayed toward zero is the obvious way to produce Infinity.
      const scenario: PresetLabScenario = frame < 300 ? 'full-mix' : 'silence';
      fillScenarioSpectrum(spectrum, scenario, timeMs);
      fillScenarioWaveform(waveform, scenario, timeMs);
      const signals = tracker.update({
        time: timeMs / 1000,
        deltaMs: FRAME_MS,
        analyser: null,
        frequencyData: spectrum,
        waveformData: waveform,
      });

      for (const value of [
        signals.bass,
        signals.mid,
        signals.treb,
        signals.bass_att,
        signals.mid_att,
        signals.treb_att,
      ]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(5);
      }
    }
  });
});
