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

      const bass = bands.bass;
      const mid = bands.mid;
      const treble = bands.treble;
      const bassAtt = update.smoothedBands.bass;
      const midsAtt = update.smoothedBands.mid;
      const trebleAtt = update.smoothedBands.treble;
      const beatPulse = update.beatIntensity;

      return {
        time,
        deltaMs,
        frame,
        fps: deltaMs > 0 ? 1000 / deltaMs : 60,
        bass,
        mid,
        mids: mid,
        treb: treble,
        treble,
        bassAtt,
        midsAtt,
        trebleAtt,
        bass_att: bassAtt,
        mid_att: midsAtt,
        mids_att: midsAtt,
        treb_att: trebleAtt,
        treble_att: trebleAtt,
        rms,
        vol: rms,
        music: weightedEnergy,
        beat: update.isBeat ? 1 : 0,
        beatPulse,
        beat_pulse: beatPulse,
        weightedEnergy,
        frequencyData,
      };
    },
  };
}
