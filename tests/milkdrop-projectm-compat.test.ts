import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import type {
  MilkdropCompiledPreset,
  MilkdropFrameState,
  MilkdropRuntimeSignals,
} from '../assets/js/milkdrop/types.ts';
import { createMilkdropVM } from '../assets/js/milkdrop/vm.ts';

const PROJECTM_CORPUS_DIR = join(
  process.cwd(),
  'tests',
  'fixtures',
  'milkdrop',
  'projectm-upstream',
);
const PROJECTM_COMPATIBILITY_SNAPSHOT_PATH = join(
  PROJECTM_CORPUS_DIR,
  'compatibility-metadata.snapshot.json',
);

const PROJECTM_PRESET_FILES = [
  '000-empty.milk',
  '001-line.milk',
  '100-square.milk',
  '101-per_frame.milk',
  '102-per_frame3.milk',
  '103-multiple-eqn.milk',
  '104-continued-eqn.milk',
  '105-per_frame_init.milk',
  '110-per_pixel.milk',
  '200-wave.milk',
  '201-wave.milk',
  '202-wave.milk',
  '203-wave.milk',
  '204-wave.milk',
  '205-wave.milk',
  '206-wave.milk',
  '207-wave.milk',
  '208-wave.milk',
  '209-wave.milk',
  '210-wave.milk',
  '211-wave.milk',
  '212-wave.milk',
  '213-wave.milk',
  '214-wave.milk',
  '215-wave.milk',
  '240-wave-smooth-00.milk',
  '241-wave-smooth-01.milk',
  '242-wave-smooth-80.milk',
  '243-wave-smooth-90.milk',
  '244-wave-smooth-99.milk',
  '245-wave-smooth-100.milk',
  '250-wavecode.milk',
  '251-wavecode-spectrum.milk',
  '252-wavecode-spectrum2.milk',
  '260-compshader-noise_lq.milk',
  '261-compshader-noisevol_lq.milk',
  '300-beatdetect-bassmidtreb.milk',
] as const;

type ProjectMFixtureExpectation = {
  diagnostics: readonly string[];
  webgl: 'supported' | 'partial' | 'unsupported';
  webgpu: 'supported' | 'partial' | 'unsupported';
  divergence: readonly string[];
  warnings: readonly string[];
  blockedConstructs: readonly string[];
  unsupportedKeys: readonly string[];
};

const FULL_SUPPORT_EXPECTATION = {
  diagnostics: [],
  webgl: 'supported',
  webgpu: 'supported',
  divergence: [],
  warnings: [],
  blockedConstructs: [],
  unsupportedKeys: [],
} as const satisfies ProjectMFixtureExpectation;

const WEBGPU_SHADER_TRANSLATION_EXPECTATION = {
  diagnostics: [],
  webgl: 'supported',
  webgpu: 'partial',
  divergence: [
    'status:webgl=supported,webgpu=partial',
    'webgpu:supported-shader-text-gap',
  ],
  warnings: [
    'WebGPU applies supported shader-text controls through a compatibility translation path that may not exactly match WebGL.',
  ],
  blockedConstructs: [],
  unsupportedKeys: [],
} as const satisfies ProjectMFixtureExpectation;

const UNSUPPORTED_SHADER_TEXT_EXPECTATION = {
  diagnostics: ['preset_unsupported_shader_text'],
  webgl: 'partial',
  webgpu: 'unsupported',
  divergence: ['status:webgl=partial,webgpu=unsupported'],
  warnings: [
    'This preset includes custom shader text outside the fully supported subset and will be approximated.',
    'WebGPU cannot safely approximate unsupported shader-text lines and must fall back to WebGL.',
  ],
  blockedConstructs: [
    'shader:ret = tex3D(sampler_fw_noisevol_lq, float3(uv, time / 10.0)).xyz',
  ],
  unsupportedKeys: [],
} as const satisfies ProjectMFixtureExpectation;

const PROJECTM_FIXTURE_EXPECTATIONS = {
  '000-empty.milk': FULL_SUPPORT_EXPECTATION,
  '001-line.milk': FULL_SUPPORT_EXPECTATION,
  '100-square.milk': FULL_SUPPORT_EXPECTATION,
  '101-per_frame.milk': FULL_SUPPORT_EXPECTATION,
  '102-per_frame3.milk': FULL_SUPPORT_EXPECTATION,
  '103-multiple-eqn.milk': FULL_SUPPORT_EXPECTATION,
  '104-continued-eqn.milk': FULL_SUPPORT_EXPECTATION,
  '105-per_frame_init.milk': FULL_SUPPORT_EXPECTATION,
  '110-per_pixel.milk': FULL_SUPPORT_EXPECTATION,
  '200-wave.milk': FULL_SUPPORT_EXPECTATION,
  '201-wave.milk': FULL_SUPPORT_EXPECTATION,
  '202-wave.milk': FULL_SUPPORT_EXPECTATION,
  '203-wave.milk': FULL_SUPPORT_EXPECTATION,
  '204-wave.milk': FULL_SUPPORT_EXPECTATION,
  '205-wave.milk': FULL_SUPPORT_EXPECTATION,
  '206-wave.milk': FULL_SUPPORT_EXPECTATION,
  '207-wave.milk': FULL_SUPPORT_EXPECTATION,
  '208-wave.milk': FULL_SUPPORT_EXPECTATION,
  '209-wave.milk': FULL_SUPPORT_EXPECTATION,
  '210-wave.milk': FULL_SUPPORT_EXPECTATION,
  '211-wave.milk': FULL_SUPPORT_EXPECTATION,
  '212-wave.milk': FULL_SUPPORT_EXPECTATION,
  '213-wave.milk': FULL_SUPPORT_EXPECTATION,
  '214-wave.milk': FULL_SUPPORT_EXPECTATION,
  '215-wave.milk': FULL_SUPPORT_EXPECTATION,
  '240-wave-smooth-00.milk': FULL_SUPPORT_EXPECTATION,
  '241-wave-smooth-01.milk': FULL_SUPPORT_EXPECTATION,
  '242-wave-smooth-80.milk': FULL_SUPPORT_EXPECTATION,
  '243-wave-smooth-90.milk': FULL_SUPPORT_EXPECTATION,
  '244-wave-smooth-99.milk': FULL_SUPPORT_EXPECTATION,
  '245-wave-smooth-100.milk': FULL_SUPPORT_EXPECTATION,
  '250-wavecode.milk': FULL_SUPPORT_EXPECTATION,
  '251-wavecode-spectrum.milk': FULL_SUPPORT_EXPECTATION,
  '252-wavecode-spectrum2.milk': FULL_SUPPORT_EXPECTATION,
  '260-compshader-noise_lq.milk': WEBGPU_SHADER_TRANSLATION_EXPECTATION,
  '261-compshader-noisevol_lq.milk': UNSUPPORTED_SHADER_TEXT_EXPECTATION,
  '300-beatdetect-bassmidtreb.milk': FULL_SUPPORT_EXPECTATION,
} as const satisfies Record<
  (typeof PROJECTM_PRESET_FILES)[number],
  ProjectMFixtureExpectation
>;

function makeSignals({
  frame = 1,
  beatPulse = frame % 2 === 0 ? 0.35 : 0.15,
  time = frame / 60,
}: {
  frame?: number;
  beatPulse?: number;
  time?: number;
} = {}): MilkdropRuntimeSignals {
  const frequencyData = new Uint8Array(64);
  frequencyData.fill(160);

  return {
    time,
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

function collectNumbers(value: unknown, values: number[]) {
  if (typeof value === 'number') {
    values.push(value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectNumbers(entry, values));
    return;
  }

  if (ArrayBuffer.isView(value) && 'length' in value) {
    Array.from(value as unknown as ArrayLike<unknown>).forEach((entry) =>
      collectNumbers(entry, values),
    );
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  Object.values(value).forEach((entry) => collectNumbers(entry, values));
}

function collectFrameNumbers(frameState: MilkdropFrameState) {
  const values: number[] = [];

  [
    frameState.background,
    frameState.waveform,
    frameState.mainWave,
    frameState.customWaves,
    frameState.trails,
    frameState.mesh,
    frameState.shapes,
    frameState.borders,
    frameState.motionVectors,
    frameState.post,
  ].forEach((entry) => collectNumbers(entry, values));

  return values;
}

function loadProjectMPresetCorpus() {
  return PROJECTM_PRESET_FILES.map((file) => {
    const raw = readFileSync(join(PROJECTM_CORPUS_DIR, file), 'utf8');
    return {
      file,
      compiled: compileMilkdropPresetSource(raw, {
        id: basename(file, '.milk'),
        title: file,
        fileName: file,
        path: join(PROJECTM_CORPUS_DIR, file),
        origin: 'user',
      }),
    };
  });
}

function buildCompatibilitySnapshot(
  file: string,
  compiled: MilkdropCompiledPreset,
) {
  return {
    file,
    diagnostics: compiled.diagnostics.map((entry) => ({
      severity: entry.severity,
      code: entry.code,
      field: entry.field ?? null,
    })),
    normalizedPrograms: {
      init: compiled.ir.programs.init.sourceLines,
      perFrame: compiled.ir.programs.perFrame.sourceLines,
      perPixel: compiled.ir.programs.perPixel.sourceLines,
      customWaves: compiled.ir.customWaves.map((wave) => ({
        index: wave.index,
        init: wave.programs.init.sourceLines,
        perFrame: wave.programs.perFrame.sourceLines,
        perPoint: wave.programs.perPoint.sourceLines,
      })),
      customShapes: compiled.ir.customShapes.map((shape) => ({
        index: shape.index,
        init: shape.programs.init.sourceLines,
        perFrame: shape.programs.perFrame.sourceLines,
      })),
    },
    compatibility: {
      unsupportedKeys: compiled.ir.compatibility.unsupportedKeys,
      warnings: compiled.ir.compatibility.warnings,
      featuresUsed: compiled.ir.compatibility.featureAnalysis.featuresUsed,
      backends: {
        webgl: {
          status: compiled.ir.compatibility.backends.webgl.status,
          evidence: compiled.ir.compatibility.backends.webgl.evidence.map(
            (entry) => ({
              scope: entry.scope,
              status: entry.status,
              code: entry.code,
              feature: entry.feature ?? null,
            }),
          ),
        },
        webgpu: {
          status: compiled.ir.compatibility.backends.webgpu.status,
          evidence: compiled.ir.compatibility.backends.webgpu.evidence.map(
            (entry) => ({
              scope: entry.scope,
              status: entry.status,
              code: entry.code,
              feature: entry.feature ?? null,
            }),
          ),
        },
      },
      parity: {
        fidelityClass: compiled.ir.compatibility.parity.fidelityClass,
        backendDivergence: compiled.ir.compatibility.parity.backendDivergence,
        ignoredFields: compiled.ir.compatibility.parity.ignoredFields,
        blockedConstructs: compiled.ir.compatibility.parity.blockedConstructs,
        approximatedShaderLines:
          compiled.ir.compatibility.parity.approximatedShaderLines,
        missingAliasesOrFunctions:
          compiled.ir.compatibility.parity.missingAliasesOrFunctions,
      },
    },
  };
}

describe('milkdrop vendored projectM fixture corpus', () => {
  test('keeps the vendored upstream fixture selection in sync', () => {
    const files = readdirSync(PROJECTM_CORPUS_DIR)
      .filter((file) => file.endsWith('.milk'))
      .sort();

    expect(files).toEqual([...PROJECTM_PRESET_FILES]);
  });

  test('compiles the vendored upstream fixture corpus with explicit per-fixture compatibility expectations', () => {
    const corpus = loadProjectMPresetCorpus();

    expect(corpus.length).toBe(PROJECTM_PRESET_FILES.length);

    corpus.forEach(({ file, compiled }) => {
      const expected = PROJECTM_FIXTURE_EXPECTATIONS[file];
      const actualDiagnosticCodes = compiled.diagnostics.map(
        (entry) => entry.code,
      );

      expect(actualDiagnosticCodes).toEqual([...expected.diagnostics]);
      expect(compiled.ir.compatibility.backends.webgl.status).toBe(
        expected.webgl,
      );
      expect(compiled.ir.compatibility.backends.webgpu.status).toBe(
        expected.webgpu,
      );
      expect(compiled.ir.compatibility.parity.backendDivergence).toEqual([
        ...expected.divergence,
      ]);
      expect(compiled.ir.compatibility.warnings).toEqual([
        ...expected.warnings,
      ]);
      expect(compiled.ir.compatibility.parity.blockedConstructs).toEqual([
        ...expected.blockedConstructs,
      ]);
      expect(compiled.ir.compatibility.unsupportedKeys).toEqual([
        ...expected.unsupportedKeys,
      ]);
    });
  });

  test('keeps projectM fZoomExponent fixtures distinct from zoom', () => {
    const raw = readFileSync(
      join(PROJECTM_CORPUS_DIR, '250-wavecode.milk'),
      'utf8',
    );
    const compiled = compileMilkdropPresetSource(
      raw.replace('fZoomExponent=1.000000', 'fZoomExponent=0.750000'),
      {
        id: '250-wavecode-zoomexp-regression',
        title: '250-wavecode.milk',
        fileName: '250-wavecode.milk',
        path: join(PROJECTM_CORPUS_DIR, '250-wavecode.milk'),
        origin: 'user',
      },
    );

    expect(compiled.ir.numericFields.zoom).toBeCloseTo(1, 6);
    expect(compiled.ir.numericFields.zoomexp).toBeCloseTo(0.75, 6);
  });

  test('keeps compiled compatibility metadata and normalized program sources stable', () => {
    const corpus = loadProjectMPresetCorpus();
    const actualSnapshot = corpus.map(({ file, compiled }) =>
      buildCompatibilitySnapshot(file, compiled),
    );
    const expectedSnapshot = JSON.parse(
      readFileSync(PROJECTM_COMPATIBILITY_SNAPSHOT_PATH, 'utf8'),
    );

    expect(actualSnapshot).toEqual(expectedSnapshot);
  });

  test('steps the vendored upstream fixture corpus through the VM without invalid frame output', () => {
    const corpus = loadProjectMPresetCorpus();

    corpus.forEach(({ file, compiled }) => {
      const vm = createMilkdropVM(compiled);

      [1, 2, 5].forEach((frame) => {
        const frameState = vm.step(makeSignals({ frame }));
        const numericValues = collectFrameNumbers(frameState);

        expect(frameState.presetId).toBe(basename(file, '.milk'));
        expect(frameState.title.length).toBeGreaterThan(0);
        expect(frameState.mainWave.positions.length).toBeGreaterThan(0);
        expect(frameState.waveform.positions.length).toBeGreaterThan(0);
        expect(numericValues.every(Number.isFinite)).toBe(true);
      });
    });
  });
});
