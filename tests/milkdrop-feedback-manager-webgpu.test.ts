import { afterEach, describe, expect, mock, test } from 'bun:test';
import { RepeatWrapping, SRGBColorSpace, Texture, TextureLoader } from 'three';
import {
  createMilkdropWebGPUFeedbackManager,
  resolveDirectShaderConstructorPattern,
  resolveDirectShaderSamplerBinding,
  resolveDirectShaderSwizzle,
} from '../assets/js/milkdrop/feedback-manager-webgpu.ts';
import {
  configureMilkdropTexture,
  getSharedMilkdropAuxTextures,
  resolveAuxTextureName,
} from '../assets/js/milkdrop/feedback-manager-webgpu-composite.ts';
import { buildFeedbackCompositeState } from '../assets/js/milkdrop/renderer-helpers/feedback-composite.ts';
import type {
  MilkdropFeedbackCompositeState,
  MilkdropRenderPayload,
  MilkdropShaderProgramPayload,
} from '../assets/js/milkdrop/types.ts';

afterEach(() => {
  mock.restore();
});

describe('milkdrop webgpu feedback manager helpers', () => {
  test('normalizes direct shader sampler aliases onto canonical runtime bindings', () => {
    expect(
      resolveDirectShaderSamplerBinding('sampler_fw_noise_lq', '2d'),
    ).toEqual({
      canonicalSource: 'noise',
      sourceId: 1,
    });
    expect(
      resolveDirectShaderSamplerBinding('sampler_fw_noisevol_lq', '3d'),
    ).toEqual({
      canonicalSource: 'simplex',
      sourceId: 2,
    });
    expect(resolveDirectShaderSamplerBinding('sampler_perlin', '2d')).toEqual({
      canonicalSource: 'perlin',
      sourceId: 1,
    });
    expect(resolveDirectShaderSamplerBinding('sampler_main', '2d')).toEqual({
      canonicalSource: 'main',
      sourceId: 0,
    });
    expect(resolveDirectShaderSamplerBinding('sampler_video', '2d')).toEqual({
      canonicalSource: 'video',
      sourceId: 8,
    });
    expect(
      resolveDirectShaderSamplerBinding('sampler_fw_noisevol_lq', '2d'),
    ).toEqual({
      canonicalSource: 'simplex',
      sourceId: 2,
    });
    expect(resolveDirectShaderSamplerBinding('sampler_noise', '3d')).toBeNull();
    expect(resolveDirectShaderSamplerBinding('sampler_main', '3d')).toBeNull();
  });

  test('supports broader direct shader swizzles for vec2 and vec3 values', () => {
    expect(resolveDirectShaderSwizzle('vec2', 'yx')).toEqual({
      kind: 'vec2',
      components: ['y', 'x'],
    });
    expect(resolveDirectShaderSwizzle('vec2', 'rr')).toEqual({
      kind: 'vec2',
      components: ['x', 'x'],
    });
    expect(resolveDirectShaderSwizzle('vec3', 'bgr')).toEqual({
      kind: 'vec3',
      components: ['z', 'y', 'x'],
    });
    expect(resolveDirectShaderSwizzle('vec3', 'xz')).toEqual({
      kind: 'vec2',
      components: ['x', 'z'],
    });
    expect(resolveDirectShaderSwizzle('vec3', 'g')).toEqual({
      kind: 'scalar',
      components: ['y'],
    });
    expect(resolveDirectShaderSwizzle('vec2', 'z')).toBeNull();
    expect(resolveDirectShaderSwizzle('vec3', 'xyzw')).toBeNull();
  });

  test('keeps only unique direct shader swizzles valid for assignment targets', () => {
    const xy = resolveDirectShaderSwizzle('vec2', 'yx');
    expect(xy).toEqual({
      kind: 'vec2',
      components: ['y', 'x'],
    });
    expect(new Set(xy?.components ?? []).size).toBe(xy?.components.length ?? 0);

    const rgb = resolveDirectShaderSwizzle('vec3', 'bgr');
    expect(rgb).toEqual({
      kind: 'vec3',
      components: ['z', 'y', 'x'],
    });
    expect(new Set(rgb?.components ?? []).size).toBe(
      rgb?.components.length ?? 0,
    );

    const duplicate = resolveDirectShaderSwizzle('vec3', 'rr');
    expect(duplicate).toEqual({
      kind: 'vec2',
      components: ['x', 'x'],
    });
    expect(new Set(duplicate?.components ?? []).size).toBeLessThan(
      duplicate?.components.length ?? 0,
    );
  });

  test('prefers explicit direct vector constructor arity over scalar splat fallbacks', () => {
    expect(
      resolveDirectShaderConstructorPattern('vec2', ['scalar', 'scalar']),
    ).toBe('vec2-pair');
    expect(
      resolveDirectShaderConstructorPattern('float2', ['scalar', 'scalar']),
    ).toBe('vec2-pair');
    expect(resolveDirectShaderConstructorPattern('vec2', ['scalar'])).toBe(
      'vec2-splat',
    );
    expect(
      resolveDirectShaderConstructorPattern('vec3', [
        'scalar',
        'scalar',
        'scalar',
      ]),
    ).toBe('vec3-triple');
    expect(
      resolveDirectShaderConstructorPattern('float3', [
        'scalar',
        'scalar',
        'scalar',
      ]),
    ).toBe('vec3-triple');
    expect(
      resolveDirectShaderConstructorPattern('vec3', ['vec2', 'scalar']),
    ).toBe('vec3-vec2-scalar');
    expect(
      resolveDirectShaderConstructorPattern('vec3', ['scalar', 'vec2']),
    ).toBe('vec3-scalar-vec2');
    expect(resolveDirectShaderConstructorPattern('vec3', ['scalar'])).toBe(
      'vec3-splat',
    );
  });

  test('keeps direct WebGPU feedback ownership explicit when direct programs are present', () => {
    const directWarpProgram = {
      stage: 'warp',
      source: 'uv = uv + vec2(0.1, 0.0)',
      normalizedLines: ['uv = uv + vec2(0.1, 0.0)'],
      statements: [
        {
          target: 'uv',
          operator: '=',
          rawValue: 'uv + vec2(0.1, 0.0)',
          expression: {
            type: 'binary',
            operator: '+',
            left: { type: 'identifier', name: 'uv' },
            right: {
              type: 'call',
              name: 'vec2',
              args: [
                { type: 'literal', value: 0.1 },
                { type: 'literal', value: 0 },
              ],
            },
          },
          source: 'uv = uv + vec2(0.1, 0.0)',
        },
      ],
      execution: {
        kind: 'direct-feedback-program',
        stage: 'warp',
        entryTarget: 'uv',
        supportedBackends: ['webgpu'],
        requiresControlFallback: true,
        statementTargets: ['uv'],
      },
    } as MilkdropShaderProgramPayload;

    const directCompProgram = {
      stage: 'comp',
      source: 'ret = ret + vec3(0.2, 0.0, 0.0)',
      normalizedLines: ['ret = ret + vec3(0.2, 0.0, 0.0)'],
      statements: [
        {
          target: 'ret',
          operator: '=',
          rawValue: 'ret + vec3(0.2, 0.0, 0.0)',
          expression: {
            type: 'binary',
            operator: '+',
            left: { type: 'identifier', name: 'ret' },
            right: {
              type: 'call',
              name: 'vec3',
              args: [
                { type: 'literal', value: 0.2 },
                { type: 'literal', value: 0 },
                { type: 'literal', value: 0 },
              ],
            },
          },
          source: 'ret = ret + vec3(0.2, 0.0, 0.0)',
        },
      ],
      execution: {
        kind: 'direct-feedback-program',
        stage: 'comp',
        entryTarget: 'ret',
        supportedBackends: ['webgpu'],
        requiresControlFallback: true,
        statementTargets: ['ret'],
      },
    } as MilkdropShaderProgramPayload;

    const frameState = {
      post: {
        shaderControls: {
          warpScale: 0.25,
          offsetX: 0.1,
          offsetY: -0.05,
          rotation: 0.2,
          zoom: 0.85,
          saturation: 0.9,
          contrast: 1.1,
          colorScale: { r: 0.7, g: 0.8, b: 0.9 },
          hueShift: 0.05,
          mixAlpha: 0.33,
          brightenBoost: 0.1,
          invertBoost: 0.0,
          solarizeBoost: 0.0,
          tint: { r: 1, g: 1, b: 1 },
          textureLayer: {
            source: 'noise',
            mode: 'replace',
            sampleDimension: '2d',
            inverted: false,
            amount: 0.4,
            scaleX: 1,
            scaleY: 1,
            offsetX: 0,
            offsetY: 0,
            volumeSliceZ: null,
          },
          warpTexture: {
            source: 'simplex',
            sampleDimension: '3d',
            amount: 0.5,
            scaleX: 1,
            scaleY: 1,
            offsetX: 0,
            offsetY: 0,
            volumeSliceZ: 0.75,
          },
        },
        shaderPrograms: {
          warp: directWarpProgram,
          comp: directCompProgram,
        },
        videoEchoEnabled: true,
        videoEchoAlpha: 0.4,
        videoEchoZoom: 0.95,
        videoEchoOrientation: 2,
        brighten: false,
        darken: false,
        darkenCenter: false,
        solarize: false,
        invert: false,
        gammaAdj: 1,
        textureWrap: false,
        feedbackTexture: false,
        warp: 0,
      },
      signals: {
        bass: 0.2,
        beat: 0,
        beatPulse: 0.3,
        frame: 1,
        fps: 60,
        mid: 0.4,
        mids: 0.4,
        rms: 0.5,
        treble: 0.6,
        bassAtt: 0.1,
        midAtt: 0.1,
        midsAtt: 0.1,
        trebleAtt: 0.1,
        vol: 0.5,
        music: 0.5,
        weightedEnergy: 0.6,
        time: 1,
      },
    } as unknown as MilkdropRenderPayload['frameState'];

    const compositeState = buildFeedbackCompositeState({
      frameState,
      backend: 'webgpu',
      directFeedbackShaders: true,
      webgpuFeedbackPlanShaderExecution: 'direct',
      getShaderTextureSourceId: (source) =>
        ({ none: 0, noise: 1, simplex: 2 })[source] ?? 0,
      getShaderTextureBlendModeId: (mode) =>
        ({ none: 0, replace: 1, mix: 2 })[mode] ?? 0,
      getShaderSampleDimensionId: (dimension) => (dimension === '3d' ? 1 : 0),
    }) as MilkdropFeedbackCompositeState;

    expect(compositeState.shaderExecution).toBe('direct');
    expect(compositeState.shaderPrograms.warp).toBe(directWarpProgram);
    expect(compositeState.shaderPrograms.comp).toBe(directCompProgram);
    expect(compositeState.mixAlpha).toBeCloseTo(0.33, 6);
    expect(compositeState.warpTextureVolumeSliceZ).toBe(0.75);
    expect(compositeState.overlayTextureVolumeSliceZ).toBe(0);
  });

  test('keeps gamma adjustment on the direct WebGPU composite branch', () => {
    const manager = createMilkdropWebGPUFeedbackManager(
      640,
      360,
    ) as unknown as {
      compositeMaterial: {
        outputNode: {
          node: {
            shaderNode?: {
              jsFunc?: () => unknown;
            };
          };
        };
      };
      dispose: () => void;
    };

    try {
      const source =
        manager.compositeMaterial.outputNode.node.shaderNode?.jsFunc?.toString() ??
        '';
      const directBranchIndex = source.indexOf('if (hasDirectCompProgram) {');
      const controlBranchIndex = source.indexOf('if (!hasDirectCompProgram) {');
      expect(directBranchIndex).toBeGreaterThanOrEqual(0);
      expect(controlBranchIndex).toBeGreaterThan(directBranchIndex);
      expect(source).toContain('return vec4(gammaAdjusted, 1);');
    } finally {
      manager.dispose();
    }
  });

  test('wraps aux texture configuration for repeat sampling and color textures', () => {
    const linearTexture = configureMilkdropTexture(new Texture());
    const colorTexture = configureMilkdropTexture(new Texture(), true);

    expect(linearTexture.wrapS).toBe(RepeatWrapping);
    expect(linearTexture.wrapT).toBe(RepeatWrapping);
    expect(linearTexture.colorSpace).not.toBe(SRGBColorSpace);
    expect(colorTexture.wrapS).toBe(RepeatWrapping);
    expect(colorTexture.wrapT).toBe(RepeatWrapping);
    expect(colorTexture.colorSpace).toBe(SRGBColorSpace);
  });

  test('resolves aux texture slots and wrapped volume atlas phases consistently', () => {
    expect(resolveAuxTextureName(0.4)).toBeNull();
    expect(resolveAuxTextureName(1)).toBe('noise');
    expect(resolveAuxTextureName(2)).toBe('simplex');
    expect(resolveAuxTextureName(7)).toBe('fractal');
    expect(resolveAuxTextureName(8)).toBeNull();
  });

  test('reuses shared aux textures across WebGPU feedback manager instances', () => {
    const first = createMilkdropWebGPUFeedbackManager(640, 360) as unknown as {
      auxTextures: Record<string, unknown>;
      dispose: () => void;
    };
    const second = createMilkdropWebGPUFeedbackManager(640, 360) as unknown as {
      auxTextures: Record<string, unknown>;
      dispose: () => void;
    };

    expect(first.auxTextures.noise).toBe(second.auxTextures.noise);
    expect(first.auxTextures.aura).toBe(second.auxTextures.aura);
    expect(first.auxTextures.video).toBe(second.auxTextures.video);

    first.dispose();
    second.dispose();
  });

  test('does not eagerly load aux textures when a feedback manager is created', () => {
    const loadSpy = mock(TextureLoader.prototype.load);
    const manager = createMilkdropWebGPUFeedbackManager(640, 360) as {
      dispose: () => void;
    };

    try {
      expect(loadSpy).not.toHaveBeenCalled();
    } finally {
      manager.dispose();
    }
  });

  test('does not dispose shared aux textures when a WebGPU feedback manager is torn down', () => {
    const sharedTextures = getSharedMilkdropAuxTextures();
    const originalDispose = sharedTextures.noise.dispose.bind(
      sharedTextures.noise,
    );
    let disposeCalls = 0;
    sharedTextures.noise.dispose = () => {
      disposeCalls += 1;
    };

    const manager = createMilkdropWebGPUFeedbackManager(640, 360) as {
      dispose: () => void;
    };

    try {
      manager.dispose();
      expect(disposeCalls).toBe(0);
    } finally {
      sharedTextures.noise.dispose = originalDispose;
    }
  });
});
