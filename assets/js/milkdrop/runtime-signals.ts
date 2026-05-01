import type { FrequencyAnalyser } from '../core/audio-handler';
import { createBeatTracker } from '../utils/audio-beat';
import { createMilkdropAudioSignalProcessor } from './audio-signal-processor';
import type { MilkdropRuntimeSignals } from './types';

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
  const signalProcessor = createMilkdropAudioSignalProcessor();
  const beatTracker = createBeatTracker({
    threshold: 0.08,
    onsetThreshold: 0.016,
    minIntervalMs: 170,
    beatDecay: 0.88,
  });
  let frame = 0;
  let rms = 0;

  const signalCache = {
    time: 0,
    deltaMs: 16.67,
    frame: 0,
    fps: 60,
    bass: 0,
    mid: 0,
    mids: 0,
    treb: 0,
    treble: 0,
    bassAtt: 0,
    midAtt: 0,
    midsAtt: 0,
    trebleAtt: 0,
    bass_att: 0,
    mid_att: 0,
    mids_att: 0,
    treb_att: 0,
    treble_att: 0,
    rms: 0,
    vol: 0,
    music: 0,
    beat: 0,
    beatPulse: 0,
    beat_pulse: 0,
    weightedEnergy: 0,
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
    frequencyData: null as Uint8Array | null,
    waveformData: null as Uint8Array | null,
  } as unknown as MilkdropRuntimeSignals;

  let latestWeightedEnergy = 0;

  return {
    reset() {
      frame = 0;
      rms = 0;
      latestWeightedEnergy = 0;
      signalProcessor.reset();
      beatTracker.reset();
    },
    getLatestAudioEnergy() {
      return latestWeightedEnergy;
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
      const processedSignals = signalProcessor.update({
        analyser,
        sampleRate,
        frequencyData,
        deltaMs,
      });
      const { bands, attenuatedBands, rawWeightedEnergy, weightedEnergy } =
        processedSignals;
      const update = beatTracker.update(
        {
          bands: {
            bass: bands.bass,
            mid: bands.mid,
            treble: bands.treble,
          },
          weightedEnergy: rawWeightedEnergy * 0.62 + weightedEnergy * 0.38,
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

      signalCache.time = time;
      signalCache.deltaMs = deltaMs;
      signalCache.frame = frame;
      signalCache.fps = deltaMs > 0 ? 1000 / deltaMs : 60;
      signalCache.bass = bands.bass;
      signalCache.mid = bands.mid;
      signalCache.mids = bands.mid;
      signalCache.treb = bands.treble;
      signalCache.treble = bands.treble;
      signalCache.bassAtt = attenuatedBands.bass;
      signalCache.midAtt = attenuatedBands.mid;
      signalCache.midsAtt = attenuatedBands.mid;
      signalCache.trebleAtt = attenuatedBands.treble;
      signalCache.bass_att = attenuatedBands.bass;
      signalCache.mid_att = attenuatedBands.mid;
      signalCache.mids_att = attenuatedBands.mid;
      signalCache.treb_att = attenuatedBands.treble;
      signalCache.treble_att = attenuatedBands.treble;
      signalCache.rms = rms;
      signalCache.vol = rms;
      signalCache.music = weightedEnergy;
      signalCache.beat = update.isBeat ? 1 : 0;
      signalCache.beatPulse = update.beatIntensity;
      signalCache.beat_pulse = update.beatIntensity;
      signalCache.weightedEnergy = weightedEnergy;
      signalCache.frequencyData = processedSignals.frequencyData;
      signalCache.waveformData = resolvedWaveformData;
      latestWeightedEnergy = weightedEnergy;

      return signalCache;
    },
  };
}
