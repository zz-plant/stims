import { describe, expect, it } from 'bun:test';
import { getFourBandTransientMetrics } from '../../src/js/utils/audio/reactivity.ts';

describe('FourBandTransientMetrics DSP', () => {
  it('returns zeros for empty frequency buffer', () => {
    const metrics = getFourBandTransientMetrics(new Uint8Array(0));
    expect(metrics).toEqual({
      subBassEnv: 0,
      kickTransient: 0,
      vocalMidEnv: 0,
      snareSnap: 0,
    });
  });

  it('detects subBass envelope and kick transients on low frequency energy spike', () => {
    const prev = new Uint8Array(512);
    const curr = new Uint8Array(512);

    // Simulate kick drum hit in 20-250 Hz range (first ~10 bins at 44.1kHz)
    for (let i = 0; i < 12; i += 1) {
      curr[i] = 240;
    }

    const metrics = getFourBandTransientMetrics(curr, prev, 44100);
    expect(metrics.subBassEnv).toBeGreaterThan(0.2);
    expect(metrics.kickTransient).toBeGreaterThan(0.3);
  });

  it('detects vocal mid envelope and snare snap on high frequency energy onset', () => {
    const prev = new Uint8Array(512);
    const curr = new Uint8Array(512);

    // High frequency snare snap (> 3kHz)
    for (let i = 100; i < 200; i += 1) {
      curr[i] = 220;
    }

    const metrics = getFourBandTransientMetrics(curr, prev, 44100);
    expect(metrics.snareSnap).toBeGreaterThan(0.2);
  });
});
