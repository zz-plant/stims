import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { WebGLRenderer } from 'three';
import { PerspectiveCamera, Scene, Vector2 } from 'three';
import { importFresh } from './test-helpers.ts';

class MockEffectComposer {
  readonly renderer: unknown;
  readonly passes: unknown[] = [];
  readonly setSize = mock((width: number, height: number) => {
    this.size.set(width, height);
  });
  readonly render = mock(() => {});
  readonly dispose = mock(() => {});
  readonly size = new Vector2(1, 1);

  constructor(renderer: unknown) {
    this.renderer = renderer;
  }

  addPass(pass: unknown) {
    this.passes.push(pass);
  }
}

class MockRenderPass {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;

  constructor(scene: Scene, camera: PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
  }
}

class MockUnrealBloomPass {
  readonly resolution: Vector2;
  readonly strength: number;
  readonly radius: number;
  readonly threshold: number;

  constructor(
    resolution: Vector2,
    strength: number,
    radius: number,
    threshold: number,
  ) {
    this.resolution = resolution;
    this.strength = strength;
    this.radius = radius;
    this.threshold = threshold;
  }
}

class MockFilmPass {
  readonly noise: number;
  readonly scanlines: number;
  readonly scanlineCount: number;
  readonly grayscale: boolean;
  readonly uniforms: {
    nIntensity: { value: number };
    sIntensity: { value: number };
    sCount: { value: number };
  };

  constructor(noise = 0, scanlines = 0, scanlineCount = 0, grayscale = false) {
    this.noise = noise;
    this.scanlines = scanlines;
    this.scanlineCount = scanlineCount;
    this.grayscale = grayscale;
    this.uniforms = {
      nIntensity: { value: noise },
      sIntensity: { value: scanlines },
      sCount: { value: scanlineCount },
    };
  }
}

class MockAfterimagePass {
  damp: number;
  enabled = true;
  readonly dispose = mock(() => {});

  constructor(damp = 0.96) {
    this.damp = damp;
  }
}

class MockShaderPass {
  readonly material: {
    uniforms: {
      resolution: { value: Vector2 };
      vignetteStrength: { value: number };
      chromaOffset: { value: number };
      saturation: { value: number };
      contrast: { value: number };
      pulseWarp: { value: number };
    };
  };
  renderToScreen = false;

  constructor(shader: {
    uniforms: {
      resolution: { value: Vector2 };
      vignetteStrength: { value: number };
      chromaOffset: { value: number };
      saturation: { value: number };
      contrast: { value: number };
      pulseWarp: { value: number };
    };
  }) {
    this.material = {
      uniforms: {
        resolution: {
          value: shader.uniforms.resolution.value.clone(),
        },
        vignetteStrength: {
          value: shader.uniforms.vignetteStrength.value,
        },
        chromaOffset: { value: shader.uniforms.chromaOffset.value },
        saturation: { value: shader.uniforms.saturation.value },
        contrast: { value: shader.uniforms.contrast.value },
        pulseWarp: { value: shader.uniforms.pulseWarp.value },
      },
    };
  }
}

afterEach(() => {
  mock.restore();
});

describe('milkdrop postprocessing composer', () => {
  test('builds the webgl pass chain and updates custom shader uniforms', async () => {
    mock.module('three/examples/jsm/postprocessing/EffectComposer.js', () => ({
      EffectComposer: MockEffectComposer,
    }));
    mock.module('three/examples/jsm/postprocessing/FilmPass.js', () => ({
      FilmPass: MockFilmPass,
    }));
    mock.module('three/examples/jsm/postprocessing/AfterimagePass.js', () => ({
      AfterimagePass: MockAfterimagePass,
    }));
    mock.module('three/examples/jsm/postprocessing/RenderPass.js', () => ({
      RenderPass: MockRenderPass,
    }));
    mock.module('three/examples/jsm/postprocessing/ShaderPass.js', () => ({
      ShaderPass: MockShaderPass,
    }));
    mock.module('three/examples/jsm/postprocessing/UnrealBloomPass.js', () => ({
      UnrealBloomPass: MockUnrealBloomPass,
    }));

    const { createMilkdropPostprocessingComposer } = await importFresh<
      typeof import('../assets/js/core/postprocessing.ts')
    >('../assets/js/core/postprocessing.ts');

    const renderer: {
      getSize: (target: Vector2) => Vector2;
    } = {
      getSize(target: Vector2) {
        return target.set(800, 450);
      },
    };
    const scene = new Scene();
    const camera = new PerspectiveCamera(45, 16 / 9, 0.1, 10);

    const pipeline = createMilkdropPostprocessingComposer({
      renderer: renderer as unknown as WebGLRenderer,
      scene,
      camera,
      profile: {
        enabled: true,
        bloomStrength: 1.25,
        bloomRadius: 0.4,
        bloomThreshold: 0.78,
        afterimageDamp: 0.82,
        filmNoise: 0.08,
        filmScanlines: 0.12,
        filmScanlineCount: 1280,
        vignetteStrength: 0.26,
        chromaOffset: 0.0014,
        saturation: 1.14,
        contrast: 1.08,
        pulseWarp: 0.006,
      },
    });

    expect(pipeline).not.toBeNull();

    const composer = pipeline?.composer as unknown as MockEffectComposer;
    const bloomPass = pipeline?.bloomPass as unknown as MockUnrealBloomPass;
    const afterimagePass =
      pipeline?.afterimagePass as unknown as MockAfterimagePass;
    const filmPass = pipeline?.filmPass as unknown as MockFilmPass;
    const chromaPass = pipeline?.chromaPass as unknown as MockShaderPass;

    expect(composer.passes).toHaveLength(5);
    expect(composer.passes[0]).toBeInstanceOf(MockRenderPass);
    expect(composer.passes[1]).toBeInstanceOf(MockUnrealBloomPass);
    expect(composer.passes[2]).toBeInstanceOf(MockFilmPass);
    expect(composer.passes[3]).toBeInstanceOf(MockAfterimagePass);
    expect(composer.passes[4]).toBeInstanceOf(MockShaderPass);
    expect(bloomPass.strength).toBeCloseTo(1.25, 6);
    expect(bloomPass.radius).toBeCloseTo(0.4, 6);
    expect(bloomPass.threshold).toBeCloseTo(0.78, 6);
    expect(afterimagePass.damp).toBeCloseTo(0.82, 6);
    expect(filmPass.uniforms.nIntensity.value).toBeCloseTo(0.08, 6);
    expect(filmPass.uniforms.sIntensity.value).toBeCloseTo(0.12, 6);
    expect(filmPass.uniforms.sCount.value).toBe(1280);
    expect(chromaPass.material.uniforms.vignetteStrength.value).toBeCloseTo(
      0.26,
      6,
    );
    expect(chromaPass.material.uniforms.chromaOffset.value).toBeCloseTo(
      0.0014,
      6,
    );
    expect(chromaPass.material.uniforms.saturation.value).toBeCloseTo(1.14, 6);
    expect(chromaPass.material.uniforms.contrast.value).toBeCloseTo(1.08, 6);
    expect(chromaPass.material.uniforms.pulseWarp.value).toBeCloseTo(0.006, 6);

    pipeline?.applyProfile({
      enabled: true,
      bloomStrength: 1.5,
      bloomRadius: 0.45,
      bloomThreshold: 0.72,
      afterimageDamp: 0.88,
      filmNoise: 0.12,
      filmScanlines: 0.18,
      filmScanlineCount: 1440,
      vignetteStrength: 0.31,
      chromaOffset: 0.0019,
      saturation: 1.22,
      contrast: 1.16,
      pulseWarp: 0.009,
    });

    expect(bloomPass.strength).toBeCloseTo(1.5, 6);
    expect(afterimagePass.damp).toBeCloseTo(0.88, 6);
    expect(filmPass.uniforms.nIntensity.value).toBeCloseTo(0.12, 6);
    expect(filmPass.uniforms.sCount.value).toBe(1440);
    expect(chromaPass.material.uniforms.vignetteStrength.value).toBeCloseTo(
      0.31,
      6,
    );
    expect(chromaPass.material.uniforms.saturation.value).toBeCloseTo(1.22, 6);
    expect(chromaPass.material.uniforms.contrast.value).toBeCloseTo(1.16, 6);
    expect(chromaPass.material.uniforms.pulseWarp.value).toBeCloseTo(0.009, 6);

    renderer.getSize = (target: Vector2) => target.set(1024, 576);
    pipeline?.updateSize();

    expect(composer.setSize).toHaveBeenCalledWith(1024, 576);
    expect(chromaPass.material.uniforms.resolution.value.x).toBe(1024);
    expect(chromaPass.material.uniforms.resolution.value.y).toBe(576);
  });

  test('keeps the legacy bloom helper as a neutral wrapper', async () => {
    mock.module('three/examples/jsm/postprocessing/EffectComposer.js', () => ({
      EffectComposer: MockEffectComposer,
    }));
    mock.module('three/examples/jsm/postprocessing/FilmPass.js', () => ({
      FilmPass: MockFilmPass,
    }));
    mock.module('three/examples/jsm/postprocessing/AfterimagePass.js', () => ({
      AfterimagePass: MockAfterimagePass,
    }));
    mock.module('three/examples/jsm/postprocessing/RenderPass.js', () => ({
      RenderPass: MockRenderPass,
    }));
    mock.module('three/examples/jsm/postprocessing/ShaderPass.js', () => ({
      ShaderPass: MockShaderPass,
    }));
    mock.module('three/examples/jsm/postprocessing/UnrealBloomPass.js', () => ({
      UnrealBloomPass: MockUnrealBloomPass,
    }));

    const { createBloomComposer } = await importFresh<
      typeof import('../assets/js/core/postprocessing.ts')
    >('../assets/js/core/postprocessing.ts');

    const renderer: {
      getSize: (target: Vector2) => Vector2;
    } = {
      getSize(target: Vector2) {
        return target.set(640, 360);
      },
    };
    const scene = new Scene();
    const camera = new PerspectiveCamera(45, 16 / 9, 0.1, 10);

    const pipeline = createBloomComposer({
      renderer: renderer as unknown as WebGLRenderer,
      scene,
      camera,
      bloomStrength: 1,
    });

    const afterimagePass =
      pipeline.afterimagePass as unknown as MockAfterimagePass;
    const filmPass = pipeline.filmPass as unknown as MockFilmPass;
    const chromaPass = pipeline.chromaPass as unknown as MockShaderPass;

    expect(afterimagePass.damp).toBe(0);
    expect(filmPass.uniforms.nIntensity.value).toBe(0);
    expect(filmPass.uniforms.sIntensity.value).toBe(0);
    expect(filmPass.uniforms.sCount.value).toBe(0);
    expect(chromaPass.material.uniforms.vignetteStrength.value).toBe(0);
    expect(chromaPass.material.uniforms.chromaOffset.value).toBe(0);
    expect(chromaPass.material.uniforms.saturation.value).toBe(1);
    expect(chromaPass.material.uniforms.contrast.value).toBe(1);
    expect(chromaPass.material.uniforms.pulseWarp.value).toBe(0);
  });
});
