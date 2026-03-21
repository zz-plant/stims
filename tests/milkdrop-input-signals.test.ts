import { describe, expect, test } from 'bun:test';
import {
  applyMilkdropInteractionResponse,
  buildMilkdropInputSignalOverrides,
} from '../assets/js/milkdrop/runtime.ts';
import type { MilkdropFrameState } from '../assets/js/milkdrop/types.ts';
import type { UnifiedInputState } from '../assets/js/utils/unified-input.ts';

describe('milkdrop input signal overrides', () => {
  test('maps desktop performance state into runtime signals', () => {
    const input: UnifiedInputState = {
      time: 100,
      deltaMs: 16,
      pointers: [],
      pointerCount: 0,
      centroid: { x: 0, y: 0 },
      normalizedCentroid: { x: 0.25, y: -0.4 },
      primary: null,
      isPressed: false,
      justPressed: false,
      justReleased: false,
      dragDelta: { x: 0.12, y: -0.08 },
      source: 'pointer',
      gesture: null,
      mic: { level: 0.4, available: true },
      performance: {
        hoverActive: true,
        hover: { x: 0.3, y: -0.2 },
        wheelDelta: 0.5,
        wheelAccum: 0.75,
        dragIntensity: 0.3,
        dragAngle: Math.PI / 4,
        accentPulse: 0.9,
        sourceFlags: {
          pointer: true,
          keyboard: false,
          gamepad: false,
          mouse: true,
          touch: false,
          pen: false,
        },
        actions: {
          accent: 0.9,
          modeNext: 0.8,
          modePrevious: 0.1,
          presetNext: 0.4,
          presetPrevious: 0.2,
          quickLook1: 0.6,
          quickLook2: 0.3,
          quickLook3: 0.2,
          remix: 0.7,
        },
      },
    };

    const overrides = buildMilkdropInputSignalOverrides(input);

    expect(overrides.hoverActive).toBe(1);
    expect(overrides.hoverX).toBeCloseTo(0.3, 6);
    expect(overrides.wheelDelta).toBeCloseTo(0.5, 6);
    expect(overrides.wheelAccum).toBeCloseTo(0.75, 6);
    expect(overrides.dragIntensity).toBeCloseTo(0.3, 6);
    expect(overrides.accentPulse).toBeCloseTo(0.9, 6);
    expect(overrides.actionModeNext).toBeCloseTo(0.8, 6);
    expect(overrides.actionQuickLook1).toBeCloseTo(0.6, 6);
    expect(overrides.actionRemix).toBeCloseTo(0.7, 6);
    expect(overrides.inputSourcePointer).toBe(1);
    expect(overrides.inputSourceMouse).toBe(1);
    expect(overrides.input_source_touch).toBe(0);
  });

  test('can reuse a target object without recomputing divergent aliases', () => {
    const input: UnifiedInputState = {
      time: 100,
      deltaMs: 16,
      pointers: [],
      pointerCount: 0,
      centroid: { x: 0, y: 0 },
      normalizedCentroid: { x: 0.25, y: -0.4 },
      primary: null,
      isPressed: true,
      justPressed: false,
      justReleased: false,
      dragDelta: { x: 0.3, y: 0.4 },
      source: 'pointer',
      gesture: null,
      mic: { level: 0.4, available: true },
      performance: {
        hoverActive: false,
        hover: null,
        wheelDelta: 0,
        wheelAccum: 0,
        dragIntensity: 0,
        dragAngle: 0,
        accentPulse: 0,
        sourceFlags: {
          pointer: true,
          keyboard: false,
          gamepad: false,
          mouse: true,
          touch: false,
          pen: false,
        },
        actions: {
          accent: 0,
          modeNext: 0,
          modePrevious: 0,
          presetNext: 0,
          presetPrevious: 0,
          quickLook1: 0,
          quickLook2: 0,
          quickLook3: 0,
          remix: 0,
        },
      },
    };

    const target = { stale: 1 } as Partial<
      ReturnType<typeof buildMilkdropInputSignalOverrides>
    >;
    const overrides = buildMilkdropInputSignalOverrides(input, target);

    expect(overrides).toBe(target);
    expect(overrides.inputSpeed).toBeCloseTo(0.5, 6);
    expect(overrides.input_speed).toBeCloseTo(0.5, 6);
  });

  test('maps drag, pinch, and rotation into visible frame adjustments', () => {
    const input: UnifiedInputState = {
      time: 100,
      deltaMs: 16,
      pointers: [],
      pointerCount: 2,
      centroid: { x: 0, y: 0 },
      normalizedCentroid: { x: 0.2, y: -0.1 },
      primary: null,
      isPressed: true,
      justPressed: false,
      justReleased: false,
      dragDelta: { x: 0.18, y: -0.12 },
      source: 'pointer',
      gesture: {
        pointerCount: 2,
        scale: 1.35,
        rotation: Math.PI / 7,
        translation: { x: 0.12, y: -0.08 },
      },
      mic: { level: 0.4, available: true },
      performance: {
        hoverActive: false,
        hover: null,
        wheelDelta: 0,
        wheelAccum: 0,
        dragIntensity: 0.42,
        dragAngle: 0,
        accentPulse: 0,
        sourceFlags: {
          pointer: true,
          keyboard: false,
          gamepad: false,
          mouse: false,
          touch: true,
          pen: false,
        },
        actions: {
          accent: 0,
          modeNext: 0,
          modePrevious: 0,
          presetNext: 0,
          presetPrevious: 0,
          quickLook1: 0,
          quickLook2: 0,
          quickLook3: 0,
          remix: 0,
        },
      },
    };

    const frameState = {
      presetId: 'test-preset',
      title: 'Test',
      background: { r: 0, g: 0, b: 0 },
      waveform: {
        positions: [0, 0, 0, 0.2, 0.1, 0],
        color: { r: 1, g: 1, b: 1 },
        alpha: 1,
        thickness: 1,
        drawMode: 'line',
        additive: false,
        pointSize: 1,
      },
      mainWave: {
        positions: [0, 0, 0, 0.2, 0.1, 0],
        color: { r: 1, g: 1, b: 1 },
        alpha: 1,
        thickness: 1,
        drawMode: 'line',
        additive: false,
        pointSize: 1,
      },
      customWaves: [],
      trails: [],
      mesh: {
        positions: [-0.5, -0.5, 0, 0.5, 0.5, 0],
        color: { r: 1, g: 1, b: 1 },
        alpha: 0.2,
      },
      shapes: [
        {
          key: 'shape',
          x: 0.5,
          y: 0.5,
          radius: 0.2,
          sides: 6,
          rotation: 0,
          color: { r: 1, g: 1, b: 1 },
          borderColor: { r: 1, g: 1, b: 1 },
          additive: false,
          thickOutline: false,
        },
      ],
      borders: [],
      motionVectors: [],
      post: {
        shaderEnabled: true,
        textureWrap: false,
        feedbackTexture: true,
        outerBorderStyle: false,
        innerBorderStyle: false,
        shaderPrograms: {
          warp: null,
          comp: null,
        },
        shaderControls: {
          zoom: 1,
          warpScale: 0.3,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
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
            inverted: false,
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
      variables: {},
      compatibility: {
        supported: true,
        needsWebGLFallback: false,
        warnings: [],
        unsupportedFeatures: [],
      },
      gpuGeometry: {
        mainWave: {
          samples: [0, 0],
          velocities: [0, 0],
          mode: 0,
          centerX: 0.5,
          centerY: 0.5,
          scale: 1,
          mystery: 0,
          time: 0,
          beatPulse: 0,
          trebleAtt: 0,
          color: { r: 1, g: 1, b: 1 },
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
        motionVectorField: null,
      },
    } as unknown as MilkdropFrameState;

    const adjusted = applyMilkdropInteractionResponse(frameState, input);

    expect(adjusted.post.shaderControls.offsetX).toBeGreaterThan(0);
    expect(adjusted.post.shaderControls.rotation).toBeGreaterThan(0);
    expect(adjusted.post.videoEchoZoom).toBeGreaterThan(1);
    expect(adjusted.mainWave.positions[0]).not.toBe(
      frameState.mainWave.positions[0],
    );
    expect(adjusted.shapes[0]?.rotation).toBeGreaterThan(0);
    expect(adjusted.gpuGeometry.meshField?.rotation).toBeGreaterThan(0);
  });
});
