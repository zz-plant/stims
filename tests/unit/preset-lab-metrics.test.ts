import { describe, expect, test } from 'bun:test';
import {
  assessVariableReactivity,
  compareMetricRecords,
  computeChangedPixelRatio,
  computeImageMetrics,
  correlationWithLag,
  fillScenarioSpectrum,
  fillScenarioWaveform,
  formatMetricDeltaLines,
  PRESET_LAB_SPECTRUM_BINS,
  pearsonCorrelation,
  scenarioPulseEnvelope,
  summarizeSeries,
} from '../../scripts/preset-lab-metrics.ts';

function rawImage(
  pixels: Array<[number, number, number]>,
  width = pixels.length,
  height = 1,
) {
  const data = new Uint8Array(width * height * 3);
  pixels.forEach(([red, green, blue], index) => {
    data[index * 3] = red;
    data[index * 3 + 1] = green;
    data[index * 3 + 2] = blue;
  });
  return { data, width, height, channels: 3 };
}

describe('summarizeSeries', () => {
  test('computes mean, extremes, and population stdDev', () => {
    const stats = summarizeSeries([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(stats.mean).toBeCloseTo(5);
    expect(stats.min).toBe(2);
    expect(stats.max).toBe(9);
    expect(stats.stdDev).toBeCloseTo(2);
  });

  test('handles empty input', () => {
    expect(summarizeSeries([]).stdDev).toBe(0);
  });
});

describe('pearsonCorrelation', () => {
  test('perfect positive and negative correlation', () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
    expect(pearsonCorrelation([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
  });

  test('constant series yields 0 rather than NaN', () => {
    expect(pearsonCorrelation([1, 1, 1], [1, 2, 3])).toBe(0);
  });
});

describe('correlationWithLag', () => {
  test('detects a delayed response', () => {
    const driver = Array.from({ length: 64 }, (_, index) =>
      index % 8 === 0 ? 1 : 0,
    );
    const lag = 3;
    const response = [
      ...Array.from({ length: lag }, () => 0),
      ...driver.slice(0, driver.length - lag),
    ];
    const result = correlationWithLag(driver, response, 8);
    expect(result.lagFrames).toBe(lag);
    expect(result.correlation).toBeCloseTo(1, 1);
  });
});

describe('audio scenarios', () => {
  test('pulse envelope peaks on the beat and decays', () => {
    expect(scenarioPulseEnvelope(0)).toBeCloseTo(1);
    expect(scenarioPulseEnvelope(250)).toBeLessThan(0.5);
    expect(scenarioPulseEnvelope(400)).toBe(0);
    expect(scenarioPulseEnvelope(500)).toBeCloseTo(1);
  });

  test('band scenarios only fill their own bins', () => {
    const buffer = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
    fillScenarioSpectrum(buffer, 'bass-pulse', 0);
    const bassEnd = Math.ceil(PRESET_LAB_SPECTRUM_BINS * 0.12);
    expect(buffer[0]).toBeGreaterThan(0);
    expect(buffer[bassEnd - 1]).toBeGreaterThan(0);
    expect(buffer.slice(bassEnd).every((value) => value === 0)).toBe(true);

    fillScenarioSpectrum(buffer, 'treble-pulse', 0);
    const midEnd = Math.floor(PRESET_LAB_SPECTRUM_BINS * 0.5);
    expect(buffer.slice(0, midEnd).every((value) => value === 0)).toBe(true);
    expect(buffer[PRESET_LAB_SPECTRUM_BINS - 1]).toBeGreaterThan(0);
  });

  test('silence produces an empty spectrum and flat waveform', () => {
    const spectrum = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
    expect(fillScenarioSpectrum(spectrum, 'silence', 1234)).toBe(0);
    expect(spectrum.every((value) => value === 0)).toBe(true);

    const waveform = new Uint8Array(64);
    fillScenarioWaveform(waveform, 'silence', 1234);
    expect(waveform.every((value) => value === 128)).toBe(true);
  });

  test('scenarios are deterministic in time', () => {
    const first = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
    const second = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
    fillScenarioSpectrum(first, 'full-mix', 8321);
    fillScenarioSpectrum(second, 'full-mix', 8321);
    expect([...first]).toEqual([...second]);
  });
});

describe('assessVariableReactivity', () => {
  const frames = 240;
  const driver = Array.from({ length: frames }, (_, index) =>
    scenarioPulseEnvelope(index * 16.67),
  );

  test('flags an audio-following variable as reactive', () => {
    const response = driver.map((value) => 0.5 + value * 0.2);
    const result = assessVariableReactivity(
      'zoom',
      Array.from({ length: frames }, () => 0.5),
      { 'bass-pulse': { driver, response } },
    );
    expect(result.verdict).toBe('reactive');
    expect(result.bestScenario).toBe('bass-pulse');
    expect(Math.abs(result.bestCorrelation)).toBeGreaterThan(0.9);
  });

  test('flags a never-moving variable as static', () => {
    const flat = Array.from({ length: frames }, () => 1.2);
    const result = assessVariableReactivity('warp', flat, {
      'bass-pulse': { driver, response: flat },
    });
    expect(result.verdict).toBe('static');
  });

  test('flags a time-driven but audio-indifferent variable as autonomous', () => {
    const drift = Array.from({ length: frames }, (_, index) =>
      Math.sin(index * 0.05),
    );
    const result = assessVariableReactivity('rot', drift, {
      'bass-pulse': { driver, response: drift },
    });
    expect(result.verdict).toBe('autonomous');
  });
});

describe('image metrics', () => {
  test('measures a black frame as near-black and colorless', () => {
    const metrics = computeImageMetrics(
      rawImage(Array.from({ length: 16 }, () => [0, 0, 0])),
    );
    expect(metrics.nearBlack).toBe(true);
    expect(metrics.colorfulness).toBe(0);
    expect(metrics.visiblePixelRatio).toBe(0);
  });

  test('measures colorful content', () => {
    const metrics = computeImageMetrics(
      rawImage([
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
        [128, 128, 128],
      ]),
    );
    expect(metrics.nearBlack).toBe(false);
    expect(metrics.colorfulness).toBeCloseTo(0.75);
    expect(metrics.clippedHighlightRatio).toBeCloseTo(0.75);
  });

  test('changed pixel ratio counts only meaningful changes', () => {
    const first = rawImage([
      [10, 10, 10],
      [200, 200, 200],
    ]);
    const second = rawImage([
      [12, 12, 12],
      [100, 200, 200],
    ]);
    expect(computeChangedPixelRatio(first, second)).toBeCloseTo(0.5);
  });

  test('dimension mismatch reads as fully changed', () => {
    const first = rawImage([[0, 0, 0]]);
    const second = rawImage([
      [0, 0, 0],
      [0, 0, 0],
    ]);
    expect(computeChangedPixelRatio(first, second)).toBe(1);
  });
});

describe('baseline comparison', () => {
  const specs = [
    {
      key: 'bestCorrelation',
      label: 'best correlation',
      betterWhen: 'higher' as const,
      tolerance: 0.02,
    },
    {
      key: 'nearBlackRatio',
      label: 'near-black frames',
      betterWhen: 'lower' as const,
      tolerance: 0.01,
    },
  ];

  test('classifies improvements and regressions per metric semantics', () => {
    const deltas = compareMetricRecords(
      specs,
      { bestCorrelation: 0.2, nearBlackRatio: 0.5 },
      { bestCorrelation: 0.6, nearBlackRatio: 0.8 },
    );
    expect(deltas[0]?.direction).toBe('improved');
    expect(deltas[1]?.direction).toBe('regressed');
    const lines = formatMetricDeltaLines(deltas);
    expect(lines[0]).toContain('improved');
    expect(lines[1]).toContain('REGRESSED');
  });

  test('marks missing metrics instead of throwing', () => {
    const deltas = compareMetricRecords(specs, {}, { bestCorrelation: 0.4 });
    expect(deltas[0]?.direction).toBe('missing');
  });
});
