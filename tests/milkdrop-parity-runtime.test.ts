import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import type {
  MilkdropParityAllowlistEntry,
  MilkdropRuntimeSignals,
} from '../assets/js/milkdrop/types.ts';
import { createMilkdropVM } from '../assets/js/milkdrop/vm.ts';

type ParityCorpusManifest = {
  presets: Array<{
    id: string;
    title: string;
    file: string;
  }>;
};

function loadParityManifest() {
  return JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        'assets',
        'data',
        'milkdrop-parity',
        'corpus-manifest.json',
      ),
      'utf8',
    ),
  ) as ParityCorpusManifest;
}

function loadParityAllowlist() {
  return (
    (
      JSON.parse(
        readFileSync(
          join(
            process.cwd(),
            'assets',
            'data',
            'milkdrop-parity',
            'allowlist.json',
          ),
          'utf8',
        ),
      ) as { entries?: MilkdropParityAllowlistEntry[] }
    ).entries ?? []
  );
}

function makeSignals(frame: number): MilkdropRuntimeSignals {
  const frequencyData = new Uint8Array(64);
  frequencyData.fill(160);
  const beatPulse = frame % 2 === 0 ? 0.35 : 0.15;
  return {
    time: frame / 60,
    deltaMs: 16.67,
    frame,
    fps: 60,
    bass: 0.7,
    mid: 0.5,
    mids: 0.5,
    treb: 0.4,
    treble: 0.4,
    bassAtt: 0.6,
    bass_att: 0.6,
    mid_att: 0.45,
    midsAtt: 0.45,
    mids_att: 0.45,
    treb_att: 0.35,
    trebleAtt: 0.35,
    treble_att: 0.35,
    rms: 0.5,
    vol: 0.5,
    music: 0.58,
    beat: frame % 2,
    beatPulse,
    beat_pulse: beatPulse,
    weightedEnergy: 0.58,
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
  };
}

function finiteNumbers(values: number[]) {
  return values.every((value) => Number.isFinite(value));
}

describe('milkdrop parity corpus runtime smoke', () => {
  test(
    'steps the vendored parity corpus without NaNs or empty-frame failures',
    () => {
      const manifest = loadParityManifest();
      const allowlist = loadParityAllowlist();
      const corpusDir = join(
        process.cwd(),
        'tests',
        'fixtures',
        'milkdrop',
        'parity-corpus',
      );

      const failures = manifest.presets.flatMap((entry) => {
        const raw = readFileSync(join(corpusDir, entry.file), 'utf8');
        const compiled = compileMilkdropPresetSource(
          raw,
          {
            id: entry.id,
            title: entry.title,
            origin: 'user',
          },
          {
            fidelityMode: 'parity',
            parityAllowlist: allowlist,
          },
        );
        const vm = createMilkdropVM(compiled);

        for (const frame of [1, 2, 3]) {
          const frameState = vm.step(makeSignals(frame));
          if (
            frameState.mainWave.positions.length === 0 ||
            !finiteNumbers(frameState.mainWave.positions) ||
            !finiteNumbers(frameState.waveform.positions) ||
            frameState.customWaves.some(
              (wave) => !finiteNumbers(wave.positions),
            ) ||
            frameState.motionVectors.some(
              (vector) => !finiteNumbers(vector.positions),
            )
          ) {
            return [
              {
                id: entry.id,
                frame,
              },
            ];
          }
        }

        return [];
      });

      expect(failures).toEqual([]);
    },
    { timeout: 30000 },
  );
});
