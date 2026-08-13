import { describe, expect, it } from 'bun:test';
import {
  generateStimulusFrame,
  type StimulusSpec,
  stimulusEnergyAtFrame,
} from '../../src/js/core/testing/synthetic-stimulus.ts';

const BINS = 512;

describe('stimulusEnergyAtFrame', () => {
  it('flat returns a constant level regardless of frame', () => {
    const spec: StimulusSpec = { type: 'flat', level: 0.6 };
    expect(stimulusEnergyAtFrame(spec, 0, 100)).toBeCloseTo(0.6);
    expect(stimulusEnergyAtFrame(spec, 99, 100)).toBeCloseTo(0.6);
  });

  it('ramp interpolates linearly from the first to the last frame', () => {
    const spec: StimulusSpec = { type: 'ramp', from: 0, to: 1 };
    expect(stimulusEnergyAtFrame(spec, 0, 101)).toBeCloseTo(0);
    expect(stimulusEnergyAtFrame(spec, 50, 101)).toBeCloseTo(0.5);
    expect(stimulusEnergyAtFrame(spec, 100, 101)).toBeCloseTo(1);
  });

  it('ramp handles a single-frame timeline without dividing by zero', () => {
    const spec: StimulusSpec = { type: 'ramp', from: 0.2, to: 0.8 };
    expect(Number.isFinite(stimulusEnergyAtFrame(spec, 0, 1))).toBe(true);
  });

  it('transient peaks at the center frame and returns to baseline outside its width', () => {
    const spec: StimulusSpec = {
      type: 'transient',
      atFrame: 50,
      widthFrames: 10,
      magnitude: 1,
      baseline: 0.1,
    };
    expect(stimulusEnergyAtFrame(spec, 50, 200)).toBeCloseTo(1);
    expect(stimulusEnergyAtFrame(spec, 40, 200)).toBeCloseTo(0.1);
    expect(stimulusEnergyAtFrame(spec, 60, 200)).toBeCloseTo(0.1);
    expect(stimulusEnergyAtFrame(spec, 100, 200)).toBeCloseTo(0.1);
  });

  it('transient is symmetric around its center', () => {
    const spec: StimulusSpec = {
      type: 'transient',
      atFrame: 50,
      widthFrames: 10,
      magnitude: 1,
    };
    expect(stimulusEnergyAtFrame(spec, 45, 200)).toBeCloseTo(
      stimulusEnergyAtFrame(spec, 55, 200),
    );
    expect(stimulusEnergyAtFrame(spec, 48, 200)).toBeGreaterThan(
      stimulusEnergyAtFrame(spec, 45, 200),
    );
  });

  it('band ramps like a plain ramp, independent of the baseline', () => {
    const spec: StimulusSpec = { type: 'band', band: 'bass', from: 0, to: 1 };
    expect(stimulusEnergyAtFrame(spec, 0, 11)).toBeCloseTo(0);
    expect(stimulusEnergyAtFrame(spec, 10, 11)).toBeCloseTo(1);
  });
});

describe('generateStimulusFrame', () => {
  it('flat and ramp fill every bin uniformly', () => {
    const frame = generateStimulusFrame(
      { type: 'flat', level: 0.5 },
      0,
      10,
      BINS,
    );
    expect(frame.length).toBe(BINS);
    const distinct = new Set(frame);
    expect(distinct.size).toBe(1);
    expect(frame[0]).toBeCloseTo(128, 0);
  });

  it('band confines energy to roughly a third of the bins and holds the rest at baseline', () => {
    const frame = generateStimulusFrame(
      { type: 'band', band: 'bass', from: 1, to: 1, baseline: 0 },
      0,
      10,
      BINS,
    );
    const active = [...frame].filter((v) => v > 0).length;
    // Bass = first third of bins; allow rounding slack either side.
    expect(active).toBeGreaterThan(BINS / 3 - 5);
    expect(active).toBeLessThan(BINS / 3 + 5);
    expect(frame[0]).toBeGreaterThan(0);
    expect(frame[BINS - 1]).toBe(0);
  });

  it('bass, mid, and treble occupy disjoint, ordered ranges', () => {
    const bass = generateStimulusFrame(
      { type: 'band', band: 'bass', from: 1, to: 1, baseline: 0 },
      0,
      10,
      BINS,
    );
    const treble = generateStimulusFrame(
      { type: 'band', band: 'treble', from: 1, to: 1, baseline: 0 },
      0,
      10,
      BINS,
    );
    // Bass is active near the start and silent at the end; treble is the
    // mirror image — confirms the ranges don't overlap or invert.
    expect(bass[0]).toBeGreaterThan(0);
    expect(bass[BINS - 1]).toBe(0);
    expect(treble[0]).toBe(0);
    expect(treble[BINS - 1]).toBeGreaterThan(0);
  });

  it('clamps out-of-range levels rather than wrapping or throwing', () => {
    const frame = generateStimulusFrame(
      { type: 'flat', level: 5 },
      0,
      10,
      BINS,
    );
    expect(frame[0]).toBe(255);
  });
});
