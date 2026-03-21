import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import { loadMilkdropParityAllowlist } from '../assets/js/milkdrop/parity-allowlist.ts';
import type {
  MilkdropFrameState,
  MilkdropRuntimeSignals,
} from '../assets/js/milkdrop/types.ts';
import { createMilkdropVM } from '../assets/js/milkdrop/vm.ts';

type ParityManifestPreset = {
  id: string;
  title: string;
  file: string;
  strata: string[];
  allowlisted: boolean;
};

type ParityManifest = {
  version: number;
  backendTarget: 'webgl' | 'webgpu';
  fallbackBackend: 'webgl' | 'webgpu';
  minimumPresetCount: number;
  presetCount: number;
  defaults: {
    expectedFidelityClass: string;
    visualEvidenceTier: string;
  };
  presets: ParityManifestPreset[];
};

type VisualBaseline = {
  version: number;
  frames: number[];
  tolerance: number;
  presets: Array<{
    id: string;
    file: string;
    frames: Array<{
      frame: number;
      mainWave: { count: number };
      waveform: { count: number };
      customWaves: { count: number };
      shapes: { count: number };
      borders: { count: number };
      motionVectors: { count: number };
      post: {
        gammaAdj: number;
        videoEchoAlpha: number;
        videoEchoZoom: number;
        shaderMixAlpha: number;
      };
    }>;
  }>;
};

const PARITY_CORPUS_DIR = join(
  process.cwd(),
  'tests',
  'fixtures',
  'milkdrop',
  'parity-corpus',
);
const PARITY_MANIFEST_PATH = join(
  process.cwd(),
  'assets',
  'data',
  'milkdrop-parity',
  'corpus-manifest.json',
);
const VISUAL_BASELINES_PATH = join(
  process.cwd(),
  'assets',
  'data',
  'milkdrop-parity',
  'visual-baselines.json',
);
const REPRESENTATIVE_BACKEND_EXPECTATIONS = {
  'parity-feedback-01': {
    webgl: 'supported',
    webgpu: 'partial',
    divergence: ['status:webgl=supported,webgpu=partial'],
  },
  'parity-shader-01': {
    webgl: 'supported',
    webgpu: 'partial',
    divergence: [
      'status:webgl=supported,webgpu=partial',
      'webgpu:supported-shader-text-gap',
    ],
  },
  'parity-allowlisted-shader-gap': {
    webgl: 'supported',
    webgpu: 'partial',
    divergence: [
      'status:webgl=supported,webgpu=partial',
      'webgpu:supported-shader-text-gap',
      'webgpu:video-echo-gap:video-echo',
    ],
  },
} as const;

function loadJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

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

function compileParityPreset(entry: ParityManifestPreset) {
  const filePath = join(PARITY_CORPUS_DIR, entry.file);
  const raw = readFileSync(filePath, 'utf8');

  return compileMilkdropPresetSource(raw, {
    id: entry.id,
    title: entry.title,
    fileName: entry.file,
    path: filePath,
    origin: 'user',
  });
}

function buildFrameSummary(frameState: MilkdropFrameState) {
  return {
    mainWaveCount: frameState.mainWave.positions.length,
    waveformCount: frameState.waveform.positions.length,
    customWaveCount: frameState.customWaves.length,
    shapeCount: frameState.shapes.length,
    borderCount: frameState.borders.length,
    motionVectorCount: frameState.motionVectors.length,
    post: {
      gammaAdj: frameState.post.gammaAdj,
      videoEchoAlpha: frameState.post.videoEchoAlpha,
      videoEchoZoom: frameState.post.videoEchoZoom,
      shaderMixAlpha: frameState.post.shaderControls.mixAlpha,
    },
  };
}

describe('milkdrop parity corpus harness', () => {
  test('keeps the certified manifest, corpus, and allowlist in sync', () => {
    const manifest = loadJson<ParityManifest>(PARITY_MANIFEST_PATH);
    const allowlist = loadMilkdropParityAllowlist();
    const allowlistedIds = new Set(allowlist.entries.map((entry) => entry.id));

    expect(manifest.version).toBe(1);
    expect(manifest.presets.length).toBe(manifest.presetCount);
    expect(manifest.presets.length).toBeGreaterThanOrEqual(
      manifest.minimumPresetCount,
    );

    const manifestAllowlistedIds = manifest.presets
      .filter((entry) => entry.allowlisted)
      .map((entry) => entry.id);

    expect(manifestAllowlistedIds.sort()).toEqual([...allowlistedIds].sort());

    manifest.presets.forEach((entry) => {
      expect(existsSync(join(PARITY_CORPUS_DIR, entry.file))).toBe(true);
      expect(entry.file.endsWith('.milk')).toBe(true);
    });
  });

  test('compiles the certified parity corpus without preset errors and preserves backend availability', () => {
    const manifest = loadJson<ParityManifest>(PARITY_MANIFEST_PATH);

    manifest.presets.forEach((entry) => {
      const compiled = compileParityPreset(entry);
      const errorDiagnostics = compiled.diagnostics.filter(
        (diagnostic) => diagnostic.severity === 'error',
      );

      expect(errorDiagnostics).toEqual([]);
      const expected =
        REPRESENTATIVE_BACKEND_EXPECTATIONS[
          entry.id as keyof typeof REPRESENTATIVE_BACKEND_EXPECTATIONS
        ];
      if (!expected) {
        expect(
          compiled.ir.compatibility.backends[manifest.fallbackBackend].status,
        ).not.toBe('unsupported');
        expect(
          compiled.ir.compatibility.backends[manifest.backendTarget].status,
        ).not.toBe('unsupported');
      }
      if (expected) {
        expect(compiled.ir.compatibility.backends.webgl.status).toBe(
          expected.webgl,
        );
        expect(compiled.ir.compatibility.backends.webgpu.status).toBe(
          expected.webgpu,
        );
        expect(compiled.ir.compatibility.parity.backendDivergence).toEqual(
          expect.arrayContaining(expected.divergence),
        );
      }
    });
  });

  test('treats allowlisted parity gaps as visible but non-regressive', () => {
    const manifest = loadJson<ParityManifest>(PARITY_MANIFEST_PATH);
    const allowlistedEntry = manifest.presets.find(
      (entry) => entry.id === 'parity-allowlisted-shader-gap',
    );

    expect(allowlistedEntry).toBeDefined();
    if (!allowlistedEntry) {
      throw new Error('Missing allowlisted parity fixture in manifest.');
    }

    const compiled = compileParityPreset(allowlistedEntry);

    expect(compiled.ir.compatibility.parity.blockedConstructs).toEqual([
      'shader:unsupported(shader)',
    ]);
    expect(compiled.ir.compatibility.parity.blockingConstructDetails).toEqual([
      {
        kind: 'shader',
        value: 'unsupported(shader)',
        system: 'shader-text',
        allowlisted: true,
      },
    ]);
    expect(
      compiled.ir.compatibility.parity.degradationReasons.map(
        (reason) => reason.code,
      ),
    ).toContain('allowlisted-gap');
    expect(
      compiled.ir.compatibility.parity.degradationReasons.some(
        (reason) =>
          reason.code === 'allowlisted-gap' && reason.blocking === false,
      ),
    ).toBe(true);
    expect(compiled.ir.compatibility.parity.fidelityClass).toBe('near-exact');
  });
});

describe('milkdrop parity visual baselines', () => {
  test('replays the canonical baseline suite through the VM', () => {
    const baselines = loadJson<VisualBaseline>(VISUAL_BASELINES_PATH);

    baselines.presets.forEach((baselinePreset) => {
      const raw = readFileSync(
        join(PARITY_CORPUS_DIR, baselinePreset.file),
        'utf8',
      );
      const compiled = compileMilkdropPresetSource(raw, {
        id: baselinePreset.id,
        title: baselinePreset.id,
        fileName: baselinePreset.file,
        origin: 'user',
      });
      const vm = createMilkdropVM(compiled);

      baselinePreset.frames.forEach((baselineFrame) => {
        const frameState = vm.step(makeSignals({ frame: baselineFrame.frame }));
        const summary = buildFrameSummary(frameState);

        expect(summary.mainWaveCount).toBe(baselineFrame.mainWave.count);
        expect(summary.waveformCount).toBe(baselineFrame.waveform.count);
        expect(summary.customWaveCount).toBe(baselineFrame.customWaves.count);
        expect(summary.shapeCount).toBe(baselineFrame.shapes.count);
        expect(summary.borderCount).toBe(baselineFrame.borders.count);
        expect(summary.motionVectorCount).toBe(
          baselineFrame.motionVectors.count,
        );
        expect(summary.post.gammaAdj).toBeCloseTo(
          baselineFrame.post.gammaAdj,
          6,
        );
        expect(summary.post.videoEchoAlpha).toBeCloseTo(
          baselineFrame.post.videoEchoAlpha,
          6,
        );
        expect(summary.post.videoEchoZoom).toBeCloseTo(
          baselineFrame.post.videoEchoZoom,
          6,
        );
        expect(summary.post.shaderMixAlpha).toBeCloseTo(
          baselineFrame.post.shaderMixAlpha,
          6,
        );
      });
    });
  });
});
