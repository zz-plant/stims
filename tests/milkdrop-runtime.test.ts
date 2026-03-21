import { describe, expect, test } from 'bun:test';
import {
  applyMilkdropInteractionResponse,
  getMilkdropDetailScale,
} from '../assets/js/milkdrop/runtime.ts';
import type { MilkdropFrameState } from '../assets/js/milkdrop/types.ts';

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
    ).toBe(2);
  });
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
      trails: [],
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
        trailWaves: [],
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
      trails: [],
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
        trailWaves: [],
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
