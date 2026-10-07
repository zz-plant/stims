import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import {
  applyMilkdropInteractionResponse,
  getMilkdropDetailScale,
} from '../../src/js/milkdrop/runtime/interaction-response.ts';
import { __milkdropRuntimeTestUtils } from '../../src/js/milkdrop/runtime/test-utils.ts';
import { createMilkdropSignalTracker } from '../../src/js/milkdrop/runtime-signals.ts';
import type { MilkdropFrameState } from '../../src/js/milkdrop/types.ts';
import { createMilkdropVM } from '../../src/js/milkdrop/vm.ts';

describe('milkdrop runtime detail scale', () => {
  test('boosts detail scale on webgpu for the same quality budget', () => {
    const webglScale = getMilkdropDetailScale({
      backend: 'webgl',
      particleScale: 1,
      particleBudget: 1,
    });
    const webgpuScale = getMilkdropDetailScale({
      backend: 'webgpu',
      particleScale: 1,
      particleBudget: 1,
    });

    expect(webgpuScale).toBeGreaterThan(webglScale);
    expect(webglScale).toBeCloseTo(1.1, 6);
    expect(webgpuScale).toBeCloseTo(1.55, 6);
  });

  test('applies shader quality multipliers to the shared detail scale', () => {
    const lowScale = getMilkdropDetailScale({
      backend: 'webgpu',
      particleScale: 1,
      particleBudget: 1,
      shaderQuality: 'low',
    });
    const balancedScale = getMilkdropDetailScale({
      backend: 'webgpu',
      particleScale: 1,
      particleBudget: 1,
      shaderQuality: 'balanced',
    });
    const highScale = getMilkdropDetailScale({
      backend: 'webgpu',
      particleScale: 1,
      particleBudget: 1,
      shaderQuality: 'high',
    });

    expect(lowScale).toBeLessThan(balancedScale);
    expect(highScale).toBeGreaterThan(balancedScale);
    expect(highScale).toBeCloseTo(1.86, 6);
  });

  test('respects the shared lower and upper bounds', () => {
    expect(
      getMilkdropDetailScale({
        backend: 'webgpu',
        particleScale: 0.2,
        particleBudget: 0.2,
      }),
    ).toBe(0.5);

    expect(
      getMilkdropDetailScale({
        backend: 'webgpu',
        particleScale: 2,
        particleBudget: 2,
      }),
    ).toBe(5.0);
  });
});

describe('milkdrop runtime blend state', () => {
  test('reuses the frame reference for transition blends', () => {
    const frameState = {
      presetId: 'blend-state-reference',
    } as MilkdropFrameState;

    const blendState = __milkdropRuntimeTestUtils.cloneBlendState(frameState);

    expect(blendState?.mode).toBe('gpu');
    if (blendState?.mode !== 'gpu') {
      throw new Error('Expected a GPU blend state.');
    }
    expect(blendState.alpha).toBe(1);
    expect(blendState.previousFrame).toBe(frameState);
  });

  test.each(['webgl', 'webgpu'] as const)(
    'keeps the outgoing main wave on %s while the next preset steps',
    (backend) => {
      // The VM rebuilds its main wave in place, and the incoming preset
      // reuses those visuals within two frames. A blend holding a reference
      // drew the incoming preset's wave as the outgoing one.
      const tracker = createMilkdropSignalTracker();
      const frequencyData = new Uint8Array(64).fill(150);
      const waveformData = new Uint8Array(64);
      const signalsAt = (frame: number) => {
        for (let index = 0; index < waveformData.length; index += 1) {
          waveformData[index] = Math.round(
            128 + Math.sin(index / 5 + frame) * 60,
          );
        }
        return tracker.update({
          time: frame / 60,
          deltaMs: 1000 / 60,
          analyser: null,
          frequencyData,
          waveformData,
        });
      };
      const mainWaveOf = (frame: MilkdropFrameState) => ({
        positions: Array.from(frame.mainWave.positions),
        color: { ...frame.mainWave.color },
        procedural: frame.gpuGeometry.mainWave
          ? {
              samples: Array.from(frame.gpuGeometry.mainWave.samples),
              color: { ...frame.gpuGeometry.mainWave.color },
            }
          : null,
      });

      const vm = createMilkdropVM(
        compileMilkdropPresetSource(
          'title=Outgoing\nwave_mode=0\nwave_r=1\nwave_g=0\nwave_b=0',
          { id: 'blend-outgoing' },
        ),
      );
      vm.setRenderBackend(backend);
      const blendState = __milkdropRuntimeTestUtils.cloneBlendState(
        vm.step(signalsAt(1)),
      );
      if (blendState?.mode !== 'gpu') {
        throw new Error('Expected a GPU blend state.');
      }
      const outgoing = mainWaveOf(blendState.previousFrame);

      vm.setPreset(
        compileMilkdropPresetSource(
          'title=Incoming\nwave_mode=1\nwave_r=0\nwave_g=0\nwave_b=1',
          { id: 'blend-incoming' },
        ),
      );
      vm.setRenderBackend(backend);
      let incoming = vm.step(signalsAt(2));
      for (let frame = 3; frame <= 8; frame += 1) {
        incoming = vm.step(signalsAt(frame));
      }

      expect(mainWaveOf(incoming)).not.toEqual(outgoing);
      expect(mainWaveOf(blendState.previousFrame)).toEqual(outgoing);
    },
  );
});

describe('milkdrop runtime GPU descriptor interaction response', () => {
  test('adjusts procedural field descriptors alongside scene interaction transforms', () => {
    const frameState = {
      presetId: 'runtime-descriptor-test',
      title: 'Runtime Descriptor Test',
      background: { r: 0, g: 0, b: 0, a: 1 },
      waveform: {
        positions: [0, 0, 0.24, 0.2, 0.1, 0.24],
        color: { r: 1, g: 1, b: 1, a: 1 },
        alpha: 1,
        thickness: 1,
        drawMode: 'line',
        additive: false,
        pointSize: 1,
      },
      mainWave: {
        positions: [0, 0, 0.24, 0.2, 0.1, 0.24],
        color: { r: 1, g: 1, b: 1, a: 1 },
        alpha: 1,
        thickness: 1,
        drawMode: 'line',
        additive: false,
        pointSize: 1,
      },
      customWaves: [],
      mesh: {
        positions: [],
        color: { r: 0.4, g: 0.6, b: 1, a: 0.2 },
        alpha: 0.2,
      },
      shapes: [],
      borders: [],
      motionVectors: [],
      post: {
        shaderEnabled: true,
        textureWrap: false,
        feedbackTexture: true,
        outerBorderStyle: false,
        innerBorderStyle: false,
        shaderControls: {
          mixAlpha: 0,
          warpScale: 0.1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
          zoom: 1,
          saturation: 1,
          contrast: 1,
          hueShift: 0,
          brightenBoost: 0,
          invertBoost: 0,
          solarizeBoost: 0,
          colorScale: { r: 1, g: 1, b: 1 },
          tint: { r: 0, g: 0, b: 0 },
          textureLayer: {
            source: 'none',
            mode: 'add',
            sampleDimension: '2d',
            amount: 0,
            scaleX: 1,
            scaleY: 1,
            offsetX: 0,
            offsetY: 0,
          },
          warpTexture: {
            source: 'none',
            sampleDimension: '2d',
            amount: 0,
            scaleX: 1,
            scaleY: 1,
            offsetX: 0,
            offsetY: 0,
          },
        },
        shaderPrograms: { warp: null, comp: null },
        brighten: false,
        darken: false,
        solarize: false,
        invert: false,
        gammaAdj: 1,
        videoEchoEnabled: true,
        videoEchoAlpha: 0.2,
        videoEchoZoom: 1,
        videoEchoOrientation: 0,
        warp: 0.1,
      },
      signals: {
        time: 0,
      },
      variables: {
        mv_a: 0.3,
      },
      compatibility: {
        supported: true,
        needsWebGLFallback: false,
        warnings: [],
        unsupportedFeatures: [],
        backends: {
          webgl: { supported: true, warnings: [] },
          webgpu: { supported: true, warnings: [] },
        },
      },
      gpuGeometry: {
        mainWave: {
          samples: [0.2, 0.4],
          velocities: [0.05, 0.02],
          mode: 0,
          centerX: 0,
          centerY: 0,
          scale: 1,
          mystery: 0,
          time: 0,
          beatPulse: 0,
          trebleAtt: 0,
          color: { r: 1, g: 1, b: 1, a: 1 },
          alpha: 1,
          additive: false,
          thickness: 1,
        },
        customWaves: [],
        meshField: {
          density: 12,
          zoom: 1,
          zoomExponent: 1,
          rotation: 0,
          warp: 0.1,
          warpAnimSpeed: 1,
          centerX: 0,
          centerY: 0,
          scaleX: 1,
          scaleY: 1,
          translateX: 0,
          translateY: 0,
        },
        motionVectorField: {
          countX: 6,
          countY: 4,
          sourceOffsetX: 0.1,
          sourceOffsetY: -0.1,
          explicitLength: 0.2,
          legacyControls: true,
          zoom: 1,
          zoomExponent: 1,
          rotation: 0,
          warp: 0.1,
          warpAnimSpeed: 1,
          centerX: 0,
          centerY: 0,
          scaleX: 1,
          scaleY: 1,
          translateX: 0,
          translateY: 0,
        },
      },
    } as unknown as MilkdropFrameState;

    const adjusted = applyMilkdropInteractionResponse(frameState, {
      dragDelta: { x: 0.2, y: -0.15 },
      performance: { dragIntensity: 0.5 },
      gesture: {
        scale: 1.2,
        rotation: 0.25,
        translation: { x: 0.1, y: -0.05 },
      },
    } as never);

    expect(adjusted.gpuGeometry.mainWave?.centerX).toBeGreaterThan(0);
    expect(adjusted.gpuGeometry.mainWave?.scale).toBeGreaterThan(1);
    expect(adjusted.gpuGeometry.meshField?.rotation).toBeGreaterThan(0);
    expect(adjusted.gpuGeometry.motionVectorField?.rotation).toBeGreaterThan(0);
    expect(adjusted.gpuGeometry.motionVectorField?.explicitLength).toBeCloseTo(
      0.2,
      6,
    );
    expect(adjusted.gpuGeometry.motionVectorField?.sourceOffsetX).toBeCloseTo(
      0.1,
      6,
    );
  });

  test('preserves GPU-capable position arrays and forwards interaction payloads on webgpu', () => {
    const mainWavePositions = [0, 0, 0.24, 0.2, 0.1, 0.24];
    const frameState = {
      presetId: 'runtime-webgpu-interaction-test',
      title: 'Runtime WebGPU Interaction Test',
      background: { r: 0, g: 0, b: 0, a: 1 },
      waveform: {
        positions: mainWavePositions,
        color: { r: 1, g: 1, b: 1, a: 1 },
        alpha: 1,
        thickness: 1,
        drawMode: 'line',
        additive: false,
        pointSize: 1,
      },
      mainWave: {
        positions: mainWavePositions,
        color: { r: 1, g: 1, b: 1, a: 1 },
        alpha: 1,
        thickness: 1,
        drawMode: 'line',
        additive: false,
        pointSize: 1,
      },
      customWaves: [],
      mesh: {
        positions: [0, 0, -0.25, 0.5, 0.5, -0.25],
        color: { r: 0.4, g: 0.6, b: 1, a: 0.2 },
        alpha: 0.2,
      },
      shapes: [],
      borders: [],
      motionVectors: [
        {
          positions: [-0.2, 0, 0.18, 0.2, 0.3, 0.18],
          color: { r: 1, g: 1, b: 1, a: 1 },
          alpha: 0.3,
          thickness: 1,
          additive: false,
        },
      ],
      post: {
        shaderEnabled: true,
        textureWrap: false,
        feedbackTexture: true,
        outerBorderStyle: false,
        innerBorderStyle: false,
        shaderControls: {
          mixAlpha: 0,
          warpScale: 0.1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
          zoom: 1,
          saturation: 1,
          contrast: 1,
          hueShift: 0,
          brightenBoost: 0,
          invertBoost: 0,
          solarizeBoost: 0,
          colorScale: { r: 1, g: 1, b: 1 },
          tint: { r: 0, g: 0, b: 0 },
          textureLayer: {
            source: 'none',
            mode: 'add',
            sampleDimension: '2d',
            amount: 0,
            scaleX: 1,
            scaleY: 1,
            offsetX: 0,
            offsetY: 0,
          },
          warpTexture: {
            source: 'none',
            sampleDimension: '2d',
            amount: 0,
            scaleX: 1,
            scaleY: 1,
            offsetX: 0,
            offsetY: 0,
          },
        },
        shaderPrograms: { warp: null, comp: null },
        brighten: false,
        darken: false,
        solarize: false,
        invert: false,
        gammaAdj: 1,
        videoEchoEnabled: true,
        videoEchoAlpha: 0.2,
        videoEchoZoom: 1,
        videoEchoOrientation: 0,
        warp: 0.1,
      },
      signals: {
        time: 0,
      },
      variables: {
        mv_a: 0.3,
      },
      compatibility: {
        supported: true,
        needsWebGLFallback: false,
        warnings: [],
        unsupportedFeatures: [],
        backends: {
          webgl: { supported: true, warnings: [] },
          webgpu: { supported: true, warnings: [] },
        },
      },
      gpuGeometry: {
        mainWave: {
          samples: [0.2, 0.4],
          velocities: [0.05, 0.02],
          mode: 0,
          centerX: 0,
          centerY: 0,
          scale: 1,
          mystery: 0,
          time: 0,
          beatPulse: 0,
          trebleAtt: 0,
          color: { r: 1, g: 1, b: 1, a: 1 },
          alpha: 1,
          additive: false,
          thickness: 1,
        },
        customWaves: [],
        meshField: {
          density: 12,
          zoom: 1,
          zoomExponent: 1,
          rotation: 0,
          warp: 0.1,
          warpAnimSpeed: 1,
          centerX: 0,
          centerY: 0,
          scaleX: 1,
          scaleY: 1,
          translateX: 0,
          translateY: 0,
        },
        motionVectorField: {
          countX: 6,
          countY: 4,
          sourceOffsetX: 0.1,
          sourceOffsetY: -0.1,
          explicitLength: 0.2,
          legacyControls: true,
          zoom: 1,
          zoomExponent: 1,
          rotation: 0,
          warp: 0.1,
          warpAnimSpeed: 1,
          centerX: 0,
          centerY: 0,
          scaleX: 1,
          scaleY: 1,
          translateX: 0,
          translateY: 0,
        },
      },
    } as unknown as MilkdropFrameState;

    const adjusted = applyMilkdropInteractionResponse(
      frameState,
      {
        dragDelta: { x: 0.2, y: -0.15 },
        performance: { dragIntensity: 0.5 },
        gesture: {
          scale: 1.2,
          rotation: 0.25,
          translation: { x: 0.1, y: -0.05 },
        },
      } as never,
      'webgpu',
    );

    expect(adjusted.mainWave.positions).toBe(mainWavePositions);
    expect(adjusted.mesh.positions).toBe(frameState.mesh.positions);
    expect(adjusted.motionVectors[0]?.positions).toBe(
      frameState.motionVectors[0]?.positions,
    );
    expect(adjusted.interaction?.waves.scale).toBeGreaterThan(1);
    expect(adjusted.interaction?.mesh.alphaMultiplier).toBeGreaterThan(1);
    expect(adjusted.interaction?.motionVectors.rotation).toBeGreaterThan(0);
  });
});
