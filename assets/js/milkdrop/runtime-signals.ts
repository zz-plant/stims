import { createBeatTracker } from '../utils/audio-beat';
import type { FrequencyAnalyser } from '../utils/audio-handler';
import { getBandLevels, getWeightedEnergy } from '../utils/audio-reactivity';
import type { MilkdropRuntimeSignals } from './types';

export function createMilkdropSignalTracker() {
  const beatTracker = createBeatTracker({
    threshold: 0.34,
    minIntervalMs: 170,
    smoothing: { bass: 0.78, mid: 0.86, treble: 0.9 },
    beatDecay: 0.88,
  });
  let frame = 0;
  let rms = 0;

  return {
    reset() {
      frame = 0;
      rms = 0;
      beatTracker.reset();
    },
    update({
      time,
      deltaMs,
      analyser,
      frequencyData,
    }: {
      time: number;
      deltaMs: number;
      analyser: FrequencyAnalyser | null;
      frequencyData: Uint8Array;
    }): MilkdropRuntimeSignals {
      frame += 1;
      const bands = getBandLevels({
        analyser,
        data: frequencyData,
      });
      const weightedEnergy = getWeightedEnergy(bands, {
        weights: { bass: 0.56, mid: 0.28, treble: 0.16 },
        boost: 1.15,
      });
      const update = beatTracker.update(
        {
          bass: bands.bass,
          mid: bands.mid,
          treble: bands.treble,
        },
        time * 1000,
      );
      rms = rms * 0.82 + (analyser?.getRmsLevel() ?? weightedEnergy) * 0.18;

      return {
        time,
        deltaMs,
        frame,
        bass: bands.bass,
        mids: bands.mid,
        treble: bands.treble,
        bassAtt: update.smoothedBands.bass,
        midsAtt: update.smoothedBands.mid,
        trebleAtt: update.smoothedBands.treble,
        rms,
        beat: update.isBeat ? 1 : 0,
        beatPulse: update.beatIntensity,
        weightedEnergy,
        frequencyData,
      };
    },
  };
}
