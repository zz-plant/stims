import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import type {
  MilkdropFrameState,
  MilkdropRuntimeSignals,
} from '../assets/js/milkdrop/types.ts';
import { createMilkdropVM } from '../assets/js/milkdrop/vm.ts';

type CanonicalManifestEntry = {
  id: string;
  title: string;
  file: string;
};

type CanonicalManifest = {
  canonicalVisualSuite: string[];
  presets: CanonicalManifestEntry[];
};

type VisualMetric = {
  count: number;
  checksum: number;
};

type VisualFrameSignature = {
  frame: number;
  mainWave: VisualMetric;
  waveform: VisualMetric;
  customWaves: VisualMetric;
  shapes: VisualMetric;
  borders: VisualMetric;
  motionVectors: VisualMetric;
  post: {
    gammaAdj: number;
    videoEchoAlpha: number;
    videoEchoZoom: number;
    shaderMixAlpha: number;
    checksum: number;
  };
};

const DEFAULT_FRAMES = [1, 2, 3, 10];
const DEFAULT_TOLERANCE = 1e-6;

function loadManifest(root = process.cwd()) {
  return JSON.parse(
    readFileSync(
      join(root, 'assets', 'data', 'milkdrop-parity', 'corpus-manifest.json'),
      'utf8',
    ),
  ) as CanonicalManifest;
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

function roundMetric(value: number) {
  return Number(value.toFixed(6));
}

function checksumNumbers(values: number[]) {
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? 0;
    total += value * ((index % 17) + 1);
  }
  return roundMetric(total);
}

function flattenNestedPositions(items: Array<{ positions: number[] }>) {
  return items.flatMap((item) => item.positions);
}

function buildFrameSignature(
  frame: number,
  frameState: MilkdropFrameState,
): VisualFrameSignature {
  return {
    frame,
    mainWave: {
      count: frameState.mainWave.positions.length,
      checksum: checksumNumbers(frameState.mainWave.positions),
    },
    waveform: {
      count: frameState.waveform.positions.length,
      checksum: checksumNumbers(frameState.waveform.positions),
    },
    customWaves: {
      count: frameState.customWaves.length,
      checksum: checksumNumbers(flattenNestedPositions(frameState.customWaves)),
    },
    shapes: {
      count: frameState.shapes.length,
      checksum: checksumNumbers(
        frameState.shapes.flatMap((shape) => [
          shape.x,
          shape.y,
          shape.radius,
          shape.sides,
          shape.color.a ?? 1,
        ]),
      ),
    },
    borders: {
      count: frameState.borders.length,
      checksum: checksumNumbers(
        frameState.borders.flatMap((border) => [
          border.size,
          border.alpha,
          border.styled ? 1 : 0,
          border.color.r,
          border.color.g,
          border.color.b,
          border.color.a ?? 1,
        ]),
      ),
    },
    motionVectors: {
      count: frameState.motionVectors.length,
      checksum: checksumNumbers(
        flattenNestedPositions(frameState.motionVectors),
      ),
    },
    post: {
      gammaAdj: roundMetric(frameState.post.gammaAdj),
      videoEchoAlpha: roundMetric(frameState.post.videoEchoAlpha),
      videoEchoZoom: roundMetric(frameState.post.videoEchoZoom),
      shaderMixAlpha: roundMetric(frameState.post.shaderControls.mixAlpha),
      checksum: checksumNumbers([
        frameState.post.gammaAdj,
        frameState.post.videoEchoAlpha,
        frameState.post.videoEchoZoom,
        frameState.post.shaderControls.mixAlpha,
        frameState.post.shaderControls.rotation,
        frameState.post.shaderControls.zoom,
        frameState.post.shaderControls.offsetX,
        frameState.post.shaderControls.offsetY,
      ]),
    },
  };
}

export function generateMilkdropVisualBaselines(root = process.cwd()) {
  const manifest = loadManifest(root);
  const corpusDir = join(
    root,
    'tests',
    'fixtures',
    'milkdrop',
    'parity-corpus',
  );
  const presetsById = new Map(
    manifest.presets.map((entry) => [entry.id, entry]),
  );

  const presets = manifest.canonicalVisualSuite.map((id) => {
    const entry = presetsById.get(id);
    if (!entry) {
      throw new Error(`Unknown canonical preset ${id}.`);
    }
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
      },
    );
    const vm = createMilkdropVM(compiled);
    const frames = DEFAULT_FRAMES.map((frame) =>
      buildFrameSignature(frame, vm.step(makeSignals(frame))),
    );
    return {
      id: entry.id,
      title: entry.title,
      file: entry.file,
      frames,
    };
  });

  return {
    version: 1 as const,
    frames: DEFAULT_FRAMES,
    tolerance: DEFAULT_TOLERANCE,
    generatedAt: new Date().toISOString().slice(0, 10),
    presets,
  };
}
