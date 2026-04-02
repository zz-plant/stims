import type { FrequencyAnalyser } from '../core/audio-handler';
import { createBeatTracker } from '../utils/audio-beat';
import {
  getBandLevels,
  getWeightedEnergy,
  updateEnergyPeak,
} from '../utils/audio-reactivity';
import type { MilkdropRuntimeSignals } from './types';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smoothLevel(
  current: number,
  next: number,
  deltaMs: number,
  attackMs: number,
  releaseMs: number,
) {
  const timeConstantMs = next > current ? attackMs : releaseMs;
  const coefficient = Math.exp(-Math.max(0, deltaMs) / timeConstantMs);
  return current * coefficient + next * (1 - coefficient);
}

export function createMilkdropSignalTracker() {
  const beatTracker = createBeatTracker({
    threshold: 0.08,
    onsetThreshold: 0.016,
    minIntervalMs: 170,
    beatDecay: 0.88,
  });
  let frame = 0;
  let rms = 0;
  let energyPeak = 0.12;
  return {
    reset() {
      frame = 0;
      rms = 0;
      energyPeak = 0.12;
      beatTracker.reset();
    },
    update({
      time,
      deltaMs,
      analyser,
      frequencyData,
      waveformData,
    }: {
      time: number;
      deltaMs: number;
      analyser: FrequencyAnalyser | null;
      frequencyData: Uint8Array;
      waveformData?: Uint8Array;
    }): MilkdropRuntimeSignals {
      const resolvedWaveformData = waveformData ?? analyser?.getWaveformData();
      const sampleRate =
        typeof analyser?.getSampleRate === 'function'
          ? analyser.getSampleRate()
          : undefined;
      frame += 1;
      const bands = getBandLevels({
        analyser,
        data: frequencyData,
        sampleRate,
      });
      const rawWeightedEnergy = getWeightedEnergy(bands, {
        weights: { bass: 0.56, mid: 0.28, treble: 0.16 },
        boost: 1.15,
      });
      energyPeak = updateEnergyPeak(energyPeak, rawWeightedEnergy, {
        decay: Math.exp(-Math.max(0, deltaMs) / 720),
        floor: 0.12,
      });
      const normalizedWeightedEnergy = clamp(
        rawWeightedEnergy / Math.max(energyPeak, 0.12),
        0,
        1,
      );
      const weightedEnergy = clamp(
        rawWeightedEnergy * 0.45 + normalizedWeightedEnergy * 0.55,
        0,
        1,
      );
      const update = beatTracker.update(
        {
          bands: {
            bass: bands.bass,
            mid: bands.mid,
            treble: bands.treble,
          },
          weightedEnergy: rawWeightedEnergy,
          deltaMs,
        },
        time * 1000,
      );
      rms = smoothLevel(
        rms,
        analyser?.getRmsLevel() ?? weightedEnergy,
        deltaMs,
        44,
        180,
      );

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
        midAtt: midsAtt,
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
        inputX: 0,
        inputY: 0,
        input_x: 0,
        input_y: 0,
        inputDx: 0,
        inputDy: 0,
        input_dx: 0,
        input_dy: 0,
        inputSpeed: 0,
        input_speed: 0,
        inputPressed: 0,
        input_pressed: 0,
        inputJustPressed: 0,
        input_just_pressed: 0,
        inputJustReleased: 0,
        input_just_released: 0,
        inputCount: 0,
        input_count: 0,
        gestureScale: 1,
        gesture_scale: 1,
        gestureRotation: 0,
        gesture_rotation: 0,
        gestureTranslateX: 0,
        gestureTranslateY: 0,
        gesture_translate_x: 0,
        gesture_translate_y: 0,
        hoverActive: 0,
        hover_active: 0,
        hoverX: 0,
        hoverY: 0,
        hover_x: 0,
        hover_y: 0,
        wheelDelta: 0,
        wheel_delta: 0,
        wheelAccum: 0,
        wheel_accum: 0,
        dragIntensity: 0,
        drag_intensity: 0,
        dragAngle: 0,
        drag_angle: 0,
        accentPulse: 0,
        accent_pulse: 0,
        actionAccent: 0,
        action_accent: 0,
        actionModeNext: 0,
        action_mode_next: 0,
        actionModePrevious: 0,
        action_mode_previous: 0,
        actionPresetNext: 0,
        action_preset_next: 0,
        actionPresetPrevious: 0,
        action_preset_previous: 0,
        actionQuickLook1: 0,
        action_quick_look_1: 0,
        actionQuickLook2: 0,
        action_quick_look_2: 0,
        actionQuickLook3: 0,
        action_quick_look_3: 0,
        actionRemix: 0,
        action_remix: 0,
        inputSourcePointer: 0,
        input_source_pointer: 0,
        inputSourceKeyboard: 0,
        input_source_keyboard: 0,
        inputSourceGamepad: 0,
        input_source_gamepad: 0,
        inputSourceMouse: 0,
        input_source_mouse: 0,
        inputSourceTouch: 0,
        input_source_touch: 0,
        inputSourcePen: 0,
        input_source_pen: 0,
        motionX: 0,
        motionY: 0,
        motionZ: 0,
        motion_x: 0,
        motion_y: 0,
        motion_z: 0,
        motionEnabled: 0,
        motion_enabled: 0,
        motionStrength: 0,
        motion_strength: 0,
        frequencyData,
        waveformData: resolvedWaveformData,
      };
    },
  };
}
