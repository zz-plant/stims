import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import type { MilkdropRuntimeSignals } from '../assets/js/milkdrop/types.ts';
import { createMilkdropVM } from '../assets/js/milkdrop/vm.ts';

function makeSignals({
  frame = 1,
  beatPulse = 0.1,
  frequencyValue = 160,
  time = frame / 60,
}: {
  frame?: number;
  beatPulse?: number;
  frequencyValue?: number;
  time?: number;
} = {}): MilkdropRuntimeSignals {
  const frequencyData = new Uint8Array(64);
  frequencyData.fill(frequencyValue);

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

describe('milkdrop vm', () => {
  test('generates parity-oriented frame state with custom waves, shapes, borders, and post state', () => {
    const preset = compileMilkdropPresetSource(
      `
title=VM Smoke
bBrighten=1
ob_size=0.02
wavecode_0_enabled=1
wavecode_0_samples=48
wave_0_per_point1=y = y + sin(sample * pi * 4) * 0.08;
shapecode_0_enabled=1
shapecode_0_sides=7
shape_0_per_frame1=rad = 0.18 + bass_att * 0.04;
per_frame_1=q1 = q1 + 1; wave_a = min(1, wave_a + 0.1);
per_pixel_1=rot = rot + 0.001;
      `.trim(),
      { id: 'vm-smoke' },
    );

    const vm = createMilkdropVM(preset);
    const frameState = vm.step(makeSignals({ frame: 1 }));

    expect(frameState.presetId).toBe('vm-smoke');
    expect(frameState.title).toBe('VM Smoke');
    expect(frameState.mainWave.positions.length).toBeGreaterThan(0);
    expect(frameState.mainWave.positions.length % 3).toBe(0);
    expect(frameState.customWaves.length).toBe(1);
    expect(frameState.mesh.positions.length).toBeGreaterThan(0);
    expect(frameState.shapes.length).toBeGreaterThan(0);
    expect(frameState.borders.length).toBeGreaterThan(0);
    expect(frameState.post.brighten).toBe(true);
    expect(frameState.variables.q1).toBeCloseTo(1, 6);
  });

  test('applies wave_brighten normalization and gamma-adjusted post state', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Wave Brighten
wave_r=0.2
wave_g=0.4
wave_b=0.6
wave_brighten=1
fGammaAdj=1.75
      `.trim(),
      { id: 'wave-brighten' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals({ frame: 1 }));

    expect(frameState.mainWave.color.r).toBeCloseTo(1 / 3, 5);
    expect(frameState.mainWave.color.g).toBeCloseTo(2 / 3, 5);
    expect(frameState.mainWave.color.b).toBeCloseTo(1, 5);
    expect(frameState.post.gammaAdj).toBeCloseTo(1.75, 6);
  });

  test('applies Rovastar feedback aliases to runtime post visuals', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Rovastar Feedback Aliases VM
bTexWrap=1
bDarkenCenter=1
      `.trim(),
      { id: 'rovastar-feedback-aliases-vm' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals({ frame: 1 }));

    expect(frameState.post.textureWrap).toBe(true);
    expect(frameState.post.darkenCenter).toBe(true);
    expect(frameState.variables.texture_wrap).toBeCloseTo(1, 6);
    expect(frameState.variables.darken_center).toBeCloseTo(1, 6);
    expect(frameState.variables.btexwrap).toBeUndefined();
    expect(frameState.variables.bdarkencenter).toBeUndefined();
  });

  test.each([
    ['init', 'init_1=echo_orient=3;'],
    ['per-frame', 'per_frame_1=echo_orient=3;'],
  ])('applies echo_orient program aliases to runtime post state in %s programs', (_label, programLine) => {
    const preset = compileMilkdropPresetSource(
      `
title=Echo Orientation VM Alias
video_echo=1
${programLine}
        `.trim(),
      { id: 'echo-orientation-vm-alias' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals({ frame: 1 }));

    expect(frameState.post.videoEchoEnabled).toBe(true);
    expect(frameState.post.videoEchoOrientation).toBe(3);
    expect(frameState.variables.video_echo_orientation).toBeCloseTo(3, 6);
    expect(frameState.variables.echo_orient).toBeUndefined();
  });

  test.each([
    ['init', 'init_1=echo_orient=echo_orient+1; q1=echo_orient;'],
    ['per-frame', 'per_frame_1=echo_orient=echo_orient+1; q1=echo_orient;'],
  ])('keeps echo_orient self-references and follow-up reads normalized in %s programs', (_label, programLine) => {
    const preset = compileMilkdropPresetSource(
      `
title=Echo Orientation VM Self Reference
video_echo=1
video_echo_orientation=2
${programLine}
        `.trim(),
      { id: 'echo-orientation-vm-self-reference' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals({ frame: 1 }));

    expect(frameState.post.videoEchoOrientation).toBe(3);
    expect(frameState.variables.video_echo_orientation).toBeCloseTo(3, 6);
    expect(frameState.variables.q1).toBeCloseTo(3, 6);
    expect(frameState.variables.echo_orient).toBeUndefined();
  });

  test('builds motion vector overlays from per-pixel transforms', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Motion Overlay
motion_vectors=1
motion_vectors_x=6
motion_vectors_y=4
mv_r=0.2
mv_g=0.5
mv_b=1
mv_a=0.28
per_pixel_1=zoom=1.08; rot=0.12; warp=0.35;
      `.trim(),
      { id: 'motion-overlay' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals({ frame: 2 }));

    expect(frameState.motionVectors.length).toBeGreaterThan(0);
    expect(frameState.motionVectors[0]?.positions).toHaveLength(6);
    expect(frameState.motionVectors[0]?.color.b).toBeCloseTo(1, 6);
    expect(frameState.motionVectors[0]?.alpha).toBeGreaterThan(0.28);
  });

  test('uses legacy motion vector counts and spacing controls without canonical enable flags', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Legacy Motion Overlay
nMotionVectorsX=3
nMotionVectorsY=2
mv_dx=0.1
mv_dy=-0.05
mv_l=0.15
mv_r=0.4
mv_g=0.8
mv_b=1
mv_a=0.5
per_frame_init_1=mv_x=4;mv_y=3;
per_pixel_1=zoom=1.1; rot=0.08; warp=0.2;
      `.trim(),
      { id: 'legacy-motion-overlay' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals({ frame: 2 }));

    expect(frameState.variables.motion_vectors_x).toBeCloseTo(4, 6);
    expect(frameState.variables.motion_vectors_y).toBeCloseTo(3, 6);
    expect(frameState.motionVectors).toHaveLength(12);
    expect(frameState.motionVectors[0]?.color.g).toBeCloseTo(0.8, 6);
    expect(frameState.motionVectors[0]?.alpha).toBeCloseTo(0.5, 6);
    expect(frameState.motionVectors[0]?.positions[0]).toBeGreaterThan(-0.95);
    expect(frameState.motionVectors[0]?.positions[1]).toBeLessThan(0.95);
    const firstVectorDx =
      (frameState.motionVectors[0]?.positions[3] ?? 0) -
      (frameState.motionVectors[0]?.positions[0] ?? 0);
    const firstVectorDy =
      (frameState.motionVectors[0]?.positions[4] ?? 0) -
      (frameState.motionVectors[0]?.positions[1] ?? 0);
    expect(Math.hypot(firstVectorDx, firstVectorDy)).toBeCloseTo(0.2175, 3);
  });

  test('applies bundled mv_x/mv_y init aliases for legacy motion-vector presets', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'public',
        'milkdrop-presets',
        'eos-glowsticks-v2-03-music.milk',
      ),
      'utf8',
    );
    const preset = compileMilkdropPresetSource(source, {
      id: 'eos-glowsticks-v2-03-music',
      title: 'eos-glowsticks-v2-03-music.milk',
      origin: 'bundled',
    });

    const frameState = createMilkdropVM(preset).step(makeSignals({ frame: 2 }));

    expect(frameState.variables.motion_vectors_x).toBeCloseTo(64, 6);
    expect(frameState.variables.motion_vectors_y).toBeCloseTo(48, 6);
    expect(frameState.motionVectors.length).toBeGreaterThan(0);
  });

  test('preserves prior frame wave samples for velocity-driven main wave animation', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Wave Velocity History
wave_mode=4
wave_x=0.5
wave_y=0.5
wave_scale=1
      `.trim(),
      { id: 'wave-velocity-history' },
    );

    const vm = createMilkdropVM(preset);
    vm.step(makeSignals({ frame: 1, frequencyValue: 32, time: 0.25 }));
    const withHistory = vm.step(
      makeSignals({ frame: 2, frequencyValue: 224, time: 0.25 }),
    );
    const withoutHistory = createMilkdropVM(preset).step(
      makeSignals({ frame: 2, frequencyValue: 224, time: 0.25 }),
    );

    expect(withHistory.mainWave.positions).not.toEqual(
      withoutHistory.mainWave.positions,
    );
    expect(withHistory.mainWave.positions[1]).toBeLessThan(
      withoutHistory.mainWave.positions[1] ?? Number.POSITIVE_INFINITY,
    );
  });

  test('maps custom-wave value aliases onto the runtime sample channels', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Wave Alias Runtime
wavecode_0_enabled=1
wavecode_0_samples=8
wavecode_0_spectrum=1
wave_0_per_point1=x = value + value1;
wave_0_per_point2=y = value2;
      `.trim(),
      { id: 'wave-alias-runtime' },
    );

    const normalizedValue = 160 / 255;
    const frameState = createMilkdropVM(preset).step(makeSignals({ frame: 1 }));
    const firstPoint = frameState.customWaves[0]?.positions;

    expect(firstPoint).toBeDefined();
    expect(firstPoint?.[0]).toBeCloseTo(normalizedValue * 2, 6);
    expect(firstPoint?.[1]).toBeCloseTo(normalizedValue, 6);
  });

  test('applies legacy cx/cy/sx/sy/dx/dy mesh transforms', () => {
    const baseline = createMilkdropVM(
      compileMilkdropPresetSource(
        `
title=Mesh Baseline
mesh_density=8
zoom=1
warp=0
rot=0
        `.trim(),
        { id: 'mesh-baseline' },
      ),
    ).step(makeSignals({ frame: 2 }));

    const transformed = createMilkdropVM(
      compileMilkdropPresetSource(
        `
title=Mesh Transform
mesh_density=8
zoom=1
warp=0
rot=0
cx=0.5
cy=0.5
sx=0.5
sy=1.4
dx=0.1
dy=-0.1
        `.trim(),
        { id: 'mesh-transform' },
      ),
    ).step(makeSignals({ frame: 2 }));

    expect(transformed.mesh.positions[0]).toBeGreaterThan(
      baseline.mesh.positions[0] ?? -Infinity,
    );
    expect(transformed.mesh.positions[1]).toBeLessThan(
      baseline.mesh.positions[1] ?? Infinity,
    );
    expect(transformed.mesh.positions[10]).toBeLessThan(
      baseline.mesh.positions[10] ?? Infinity,
    );
  });

  test('keeps cpu mesh and motion-vector geometry on webgpu-safe presets', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Procedural GPU Hints
motion_vectors=1
motion_vectors_x=6
motion_vectors_y=4
mesh_density=14
zoom=1.1
rot=0.14
warp=0.2
warpanimspeed=1.5
      `.trim(),
      { id: 'procedural-gpu-hints' },
    );

    const vm = createMilkdropVM(preset);
    vm.setRenderBackend('webgpu');
    const frameState = vm.step(makeSignals({ frame: 3 }));

    expect(frameState.mesh.positions.length).toBeGreaterThan(0);
    expect(frameState.motionVectors.length).toBeGreaterThan(0);
    expect(frameState.gpuGeometry.meshField).toBeNull();
    expect(frameState.gpuGeometry.motionVectorField).toBeNull();
  });

  test('keeps main wave and trails as cpu polylines on webgpu line-wave presets', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Procedural Wave Hints
wave_mode=5
wave_usedots=0
wave_scale=1.2
wave_mystery=0.35
wave_x=0.58
wave_y=0.42
mesh_density=16
      `.trim(),
      { id: 'procedural-wave-hints' },
    );

    const vm = createMilkdropVM(preset);
    vm.setRenderBackend('webgpu');
    const firstFrame = vm.step(makeSignals({ frame: 1, time: 0.15 }));
    const secondFrame = vm.step(makeSignals({ frame: 2, time: 0.3 }));

    expect(firstFrame.mainWave.positions.length).toBeGreaterThan(0);
    expect(firstFrame.gpuGeometry.mainWave).toBeNull();
    expect(firstFrame.gpuGeometry.trailWaves).toHaveLength(0);
    expect(secondFrame.mainWave.positions.length).toBeGreaterThan(0);
    expect(secondFrame.gpuGeometry.mainWave).toBeNull();
    expect(secondFrame.gpuGeometry.trailWaves).toHaveLength(0);
    expect(secondFrame.trails.length).toBeGreaterThan(0);
  });

  test('keeps custom waves as cpu geometry on webgpu-safe custom waves', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Procedural Custom Wave Hints
wavecode_0_enabled=1
wavecode_0_samples=40
wavecode_0_spectrum=1
wavecode_0_scaling=1.15
wavecode_0_mystery=0.25
wavecode_0_usedots=0
wavecode_0_x=0.55
wavecode_0_y=0.45
wavecode_0_r=0.8
wavecode_0_g=0.4
wavecode_0_b=1
wavecode_0_a=0.35
      `.trim(),
      { id: 'procedural-custom-wave-hints' },
    );

    const vm = createMilkdropVM(preset);
    vm.setRenderBackend('webgpu');
    const frameState = vm.step(makeSignals({ frame: 4, time: 0.2 }));

    expect(frameState.customWaves).toHaveLength(1);
    expect(frameState.customWaves[0]?.positions.length).toBeGreaterThan(0);
    expect(frameState.gpuGeometry.customWaves).toHaveLength(0);
  });

  test('uses mesh history when building motion vector overlays across frames', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Motion History
motion_vectors=1
motion_vectors_x=5
motion_vectors_y=3
mv_a=0.25
per_pixel_1=zoom=1.06 + beat_pulse * 0.05; rot=rot + 0.04; warp=0.24 + bass_att * 0.1;
      `.trim(),
      { id: 'motion-history' },
    );

    const vm = createMilkdropVM(preset);
    const first = vm.step(makeSignals({ frame: 1, beatPulse: 0.15 }));
    const second = vm.step(makeSignals({ frame: 2, beatPulse: 0.35 }));

    expect(first.motionVectors.length).toBeGreaterThan(0);
    expect(second.motionVectors.length).toBeGreaterThan(0);
    expect(second.motionVectors[0]?.positions).not.toEqual(
      first.motionVectors[0]?.positions,
    );
  });

  test('warp animation speed changes per-pixel mesh deformation over time', () => {
    const slowPreset = compileMilkdropPresetSource(
      `
title=Warp Slow
warp=0.6
fWarpAnimSpeed=0.4
      `.trim(),
      { id: 'warp-slow' },
    );
    const fastPreset = compileMilkdropPresetSource(
      `
title=Warp Fast
warp=0.6
fWarpAnimSpeed=2.2
      `.trim(),
      { id: 'warp-fast' },
    );

    const slowState = createMilkdropVM(slowPreset).step(
      makeSignals({ frame: 4, time: 2.4 }),
    );
    const fastState = createMilkdropVM(fastPreset).step(
      makeSignals({ frame: 4, time: 2.4 }),
    );

    expect(slowState.mesh.positions).not.toEqual(fastState.mesh.positions);
  });

  test('modulated wave alpha and shader flag affect frame post state', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Wave Mod
wave_a=0.8
fModWaveAlphaStart=1.2
fModWaveAlphaEnd=0.25
fShader=0
      `.trim(),
      { id: 'wave-mod' },
    );

    const frameState = createMilkdropVM(preset).step(
      makeSignals({ frame: 5, time: 2.1, beatPulse: 0.35 }),
    );

    expect(frameState.post.shaderEnabled).toBe(false);
    expect(frameState.mainWave.alpha).toBeGreaterThan(0.04);
    expect(frameState.mainWave.alpha).toBeLessThan(0.8);
  });

  test('carries shader subset, border style, and feedback flags into post visuals', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Post Flags
warp_shader=warp=0.7; hue=0.25
comp_shader=mix=0.3; brighten=0.4; tint=1,0.7,0.5
texture_wrap=1
feedback_texture=1
ob_size=0.015
ob_border=1
ib_size=0.025
ib_border=1
      `.trim(),
      { id: 'post-flags' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals({ frame: 6 }));

    expect(frameState.post.textureWrap).toBe(true);
    expect(frameState.post.feedbackTexture).toBe(true);
    expect(frameState.post.shaderControls.warpScale).toBeCloseTo(0.7, 6);
    expect(frameState.post.shaderControls.mixAlpha).toBeCloseTo(0.3, 6);
    expect(frameState.borders[0]?.styled).toBe(true);
    expect(frameState.borders[1]?.styled).toBe(true);
  });

  test('carries shader transform controls into post visuals', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Shader Transform VM
warp_shader=dx=0.06; dy=-0.03; rot=0.22; zoom=1.1
      `.trim(),
      { id: 'shader-transform-vm' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals({ frame: 7 }));

    expect(frameState.post.shaderControls.offsetX).toBeCloseTo(0.06, 6);
    expect(frameState.post.shaderControls.offsetY).toBeCloseTo(-0.03, 6);
    expect(frameState.post.shaderControls.rotation).toBeCloseTo(0.22, 6);
    expect(frameState.post.shaderControls.zoom).toBeCloseTo(1.1, 6);
  });

  test('carries shader color controls into post visuals', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Shader Color VM
comp_shader=saturation=1.25; contrast=1.1; r=1.05; g=0.9; b=0.7
      `.trim(),
      { id: 'shader-color-vm' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals({ frame: 8 }));

    expect(frameState.post.shaderControls.saturation).toBeCloseTo(1.25, 6);
    expect(frameState.post.shaderControls.contrast).toBeCloseTo(1.1, 6);
    expect(frameState.post.shaderControls.colorScale.r).toBeCloseTo(1.05, 6);
    expect(frameState.post.shaderControls.colorScale.g).toBeCloseTo(0.9, 6);
    expect(frameState.post.shaderControls.colorScale.b).toBeCloseTo(0.7, 6);
  });

  test('evaluates runtime-driven shader expressions against live signals and registers', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Shader Runtime VM
per_frame_1=q1=q1+0.25;
warp_shader=dx=bass_att*0.1; rot=time*0.5; zoom=1+q1*0.1
comp_shader=mix=beat_pulse*0.5; saturation=1+mid_att*0.5; tint=1, mid, treb_att+0.2
      `.trim(),
      { id: 'shader-runtime-vm' },
    );

    const frameState = createMilkdropVM(preset).step(
      makeSignals({ frame: 9, time: 0.8, beatPulse: 0.3 }),
    );

    expect(frameState.variables.q1).toBeCloseTo(0.25, 6);
    expect(frameState.post.shaderControls.offsetX).toBeCloseTo(0.06, 6);
    expect(frameState.post.shaderControls.rotation).toBeCloseTo(0.4, 6);
    expect(frameState.post.shaderControls.zoom).toBeCloseTo(1.025, 6);
    expect(frameState.post.shaderControls.mixAlpha).toBeCloseTo(0.15, 6);
    expect(frameState.post.shaderControls.saturation).toBeCloseTo(1.225, 6);
    expect(frameState.post.shaderControls.tint.g).toBeCloseTo(0.5, 6);
    expect(frameState.post.shaderControls.tint.b).toBeCloseTo(0.55, 6);
  });

  test('evaluates shader declarations and compound assignments per frame', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Shader Extended VM
per_frame_1=q1=q1+0.5;
warp_shader=float dx = 0.01; dx += if(above(bass_att,0.5), q1*0.02, 0); rot = mix(0, time, 0.5)
comp_shader=const mix = 0.05; mix += step(0.2, beat_pulse) * 0.2; tint += 0.1, mod(mid, 0.3), fmod(treb_att + 0.2, 0.4)
      `.trim(),
      { id: 'shader-extended-vm' },
    );

    const frameState = createMilkdropVM(preset).step(
      makeSignals({ frame: 10, time: 0.8, beatPulse: 0.3 }),
    );

    expect(frameState.variables.q1).toBeCloseTo(0.5, 6);
    expect(frameState.post.shaderControls.offsetX).toBeCloseTo(0.02, 6);
    expect(frameState.post.shaderControls.rotation).toBeCloseTo(0.4, 6);
    expect(frameState.post.shaderControls.mixAlpha).toBeCloseTo(0.25, 6);
    expect(frameState.post.shaderControls.tint.r).toBeCloseTo(1.1, 6);
    expect(frameState.post.shaderControls.tint.g).toBeCloseTo(1.2, 6);
    expect(frameState.post.shaderControls.tint.b).toBeCloseTo(1.15, 6);
  });

  test('evaluates shader temp variables against live signal values', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Shader Temp VM
warp_shader=float drift = bass_att * 0.05; dx = drift; rot = drift * 4
comp_shader=const pulse = beat_pulse * 0.4; mix = pulse; tint = 1, pulse + 0.2, pulse + 0.4
      `.trim(),
      { id: 'shader-temp-vm' },
    );

    const frameState = createMilkdropVM(preset).step(
      makeSignals({ frame: 11, time: 0.5, beatPulse: 0.3 }),
    );

    expect(frameState.post.shaderControls.offsetX).toBeCloseTo(0.03, 6);
    expect(frameState.post.shaderControls.rotation).toBeCloseTo(0.12, 6);
    expect(frameState.post.shaderControls.mixAlpha).toBeCloseTo(0.12, 6);
    expect(frameState.post.shaderControls.tint.g).toBeCloseTo(0.32, 6);
    expect(frameState.post.shaderControls.tint.b).toBeCloseTo(0.52, 6);
  });

  test('evaluates vector shader temp variables against live signal values', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Shader Vector Temp VM
warp_shader=vec2 drift = vec2(bass_att * 0.05, -treb_att * 0.04); uv += drift;
comp_shader=vec3 wash = vec3(1 + bass_att * 0.2, 0.8 + mid * 0.1, 0.6 + beat_pulse * 0.2); ret = tex2d(sampler_main, uv).rgb * wash;
      `.trim(),
      { id: 'shader-vector-temp-vm' },
    );

    const frameState = createMilkdropVM(preset).step(
      makeSignals({ frame: 12, time: 0.5, beatPulse: 0.3 }),
    );

    expect(frameState.post.shaderControls.offsetX).toBeCloseTo(0.03, 6);
    expect(frameState.post.shaderControls.offsetY).toBeCloseTo(-0.014, 6);
    expect(frameState.post.shaderControls.colorScale.r).toBeCloseTo(1.12, 6);
    expect(frameState.post.shaderControls.colorScale.g).toBeCloseTo(0.85, 6);
    expect(frameState.post.shaderControls.colorScale.b).toBeCloseTo(0.66, 6);
  });

  test('keeps translated shader controls available in post visuals', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Direct Shader Program VM
comp_shader=ret = mix(tex2d(sampler_main, uv).rgb, 1.0 - tex3D(sampler_fw_noisevol_lq, float3(uv, time / 10.0)).xyz, 0.35)
      `.trim(),
      { id: 'direct-shader-program-vm' },
    );

    const frameState = createMilkdropVM(preset).step(
      makeSignals({ frame: 12 }),
    );

    expect(frameState.post.shaderPrograms.warp).toBeNull();
    expect(frameState.post.shaderPrograms.comp).toBeNull();
    expect(frameState.post.shaderControls.textureLayer.source).toBe('simplex');
    expect(frameState.post.shaderControls.textureLayer.mode).toBe('mix');
    expect(frameState.post.shaderControls.textureLayer.inverted).toBe(true);
    expect(frameState.post.shaderControls.textureLayer.amount).toBeCloseTo(
      0.35,
      6,
    );
  });

  test('renders ninth shape slot beyond the previous ceiling', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Extended Shape Slot Nine
shape_9_enabled=1
shape_9_sides=8
shape_9_rad=0.16
shape_9_a=0.28
shape_9_r=0.8
shape_9_g=0.9
shape_9_b=0.5
wavecode_8_enabled=1
wave_8_per_point1=y=y+0.015;
      `.trim(),
      { id: 'extended-shape-slot-nine' },
    );

    const frameState = createMilkdropVM(preset).step(
      makeSignals({ frame: 12 }),
    );

    expect(frameState.shapes.some((shape) => shape.key === 'shape_9')).toBe(
      true,
    );
    expect(frameState.customWaves).toHaveLength(1);
  });

  test('renders extended shape slots beyond the original four defaults', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Extended Shape Slots
shape_5_enabled=1
shape_5_sides=7
shape_5_rad=0.18
shape_5_a=0.3
shape_5_r=0.9
shape_5_g=0.7
shape_5_b=0.4
wavecode_4_enabled=1
wave_4_per_point1=y=y+0.02;
      `.trim(),
      { id: 'extended-shape-slots' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals({ frame: 8 }));

    expect(frameState.shapes.some((shape) => shape.key === 'shape_5')).toBe(
      true,
    );
    expect(frameState.customWaves).toHaveLength(1);
  });

  test('renders legacy max-slot custom wave and shape aliases at runtime', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Legacy Max Runtime Slots
wavecode_32_enabled=1
wavecode_32_samples=64
wave_32_per_point1=x=x+0.02;
shapecode_32_enabled=1
shapecode_32_sides=6
shape_32_per_frame1=rad=0.24;
      `.trim(),
      { id: 'legacy-max-runtime-slots' },
    );

    const frameState = createMilkdropVM(preset).step(makeSignals({ frame: 9 }));

    expect(frameState.customWaves).toHaveLength(1);
    expect(frameState.customWaves[0]?.positions.length).toBeGreaterThan(0);
    expect(frameState.shapes.some((shape) => shape.key === 'shape_32')).toBe(
      true,
    );
    expect(
      frameState.shapes.find((shape) => shape.key === 'shape_32')?.sides,
    ).toBe(6);
  });

  test('accumulates and caps trail history across steps', () => {
    const preset = compileMilkdropPresetSource('title=Trail Test', {
      id: 'trail-test',
    });
    const vm = createMilkdropVM(preset);

    let trailsCount = 0;
    for (let frame = 1; frame <= 8; frame += 1) {
      const state = vm.step(makeSignals({ frame }));
      trailsCount = state.trails.length;
    }

    expect(trailsCount).toBeGreaterThan(0);
    expect(trailsCount).toBeLessThanOrEqual(5);
  });

  test('detail scale affects main-wave density and setPreset resets q/t registers', () => {
    const presetA = compileMilkdropPresetSource(
      `
title=Preset A
per_frame_1=q1=q1+1;
per_frame_2=t1=t1+1;
      `.trim(),
      { id: 'preset-a' },
    );
    const presetB = compileMilkdropPresetSource('title=Preset B', {
      id: 'preset-b',
    });

    const vm = createMilkdropVM(presetA);
    const highDetail = vm.step(makeSignals({ frame: 1, beatPulse: 0.2 }));
    vm.setDetailScale(0.5);
    const lowDetail = vm.step(makeSignals({ frame: 2, beatPulse: 0.2 }));

    expect(lowDetail.mainWave.positions.length).toBeLessThan(
      highDetail.mainWave.positions.length,
    );

    vm.setPreset(presetB);
    const resetFrame = vm.step(makeSignals({ frame: 3, beatPulse: 0.2 }));
    expect(resetFrame.presetId).toBe('preset-b');
    expect(resetFrame.variables.q1).toBe(0);
    expect(resetFrame.variables.t1).toBe(0);
  });

  test('renders distinct geometry across all eight main wave modes', () => {
    const signatures = new Set<string>();

    for (let mode = 0; mode < 8; mode += 1) {
      const preset = compileMilkdropPresetSource(
        `
title=Wave Mode ${mode}
wave_mode=${mode}
wave_mystery=0.42
        `.trim(),
        { id: `wave-mode-${mode}` },
      );

      const frameState = createMilkdropVM(preset).step(
        makeSignals({ frame: 3, beatPulse: 0.2 }),
      );

      expect(frameState.mainWave.positions.length).toBeGreaterThan(0);
      signatures.add(
        frameState.mainWave.positions
          .slice(0, 18)
          .map((value) => value.toFixed(3))
          .join(','),
      );
    }

    expect(signatures.size).toBe(8);
  });

  test('keeps the main wave stateful across successive frames', () => {
    const preset = compileMilkdropPresetSource(
      `
title=Wave History
wave_mode=1
wave_mystery=0.55
      `.trim(),
      { id: 'wave-history' },
    );
    const vm = createMilkdropVM(preset);
    const first = vm.step(makeSignals({ frame: 1, beatPulse: 0.1 }));
    const second = vm.step(makeSignals({ frame: 2, beatPulse: 0.3 }));

    expect(second.mainWave.positions).not.toEqual(first.mainWave.positions);
  });
});
