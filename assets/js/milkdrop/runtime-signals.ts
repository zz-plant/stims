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
      const waveformData =
        analyser && 'getWaveformData' in analyser
          ? analyser.getWaveformData()
          : undefined;

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
        waveformData,
      };
    },
  };
}
