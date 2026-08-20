import type { Camera, Scene, WebGLRenderer } from 'three';
import { Vector2 } from 'three';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { FilmPass } from 'three/examples/jsm/postprocessing/FilmPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { isMobileDevice } from '../utils/browser/device-detect.ts';
import { getDevicePerformanceProfile } from './device-profile.ts';
import type { RendererBackend } from './renderer-capabilities';

export type MilkdropPostprocessingProfile = {
  enabled: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  afterimageDamp: number;
  filmNoise: number;
  filmScanlines: number;
  filmScanlineCount: number;
  vignetteStrength: number;
  chromaOffset: number;
  saturation: number;
  contrast: number;
  pulseWarp: number;
};

export type PostprocessingPipeline = {
  composer: EffectComposer;
  bloomPass?: UnrealBloomPass;
  afterimagePass?: AfterimagePass;
  filmPass?: FilmPass;
  chromaPass?: ShaderPass;
  applyProfile: (profile: MilkdropPostprocessingProfile) => void;
  render: () => void;
  updateSize: () => void;
  dispose: () => void;
};

type FilmPassUniforms = {
  nIntensity: { value: number };
  sIntensity: { value: number };
  sCount: { value: number };
};

type FilmPassWithUniforms = FilmPass & {
  uniforms: FilmPassUniforms;
};

function setUniformValue(
  uniforms: Record<string, { value: unknown }> | null | undefined,
  key: string,
  value: unknown,
) {
  const target = uniforms?.[key];
  if (!target) {
    return false;
  }
  target.value = value;
  return true;
}

import { CAS_GLSL_SNIPPET } from './shaders/cas.ts';

const MILKDROP_POSTPROCESSING_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new Vector2(1, 1) },
    vignetteStrength: { value: 0 },
    chromaOffset: { value: 0 },
    saturation: { value: 1 },
    contrast: { value: 1 },
    pulseWarp: { value: 0 },
    casSharpness: { value: 0.25 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float vignetteStrength;
    uniform float chromaOffset;
    uniform float saturation;
    uniform float contrast;
    uniform float pulseWarp;
    uniform float casSharpness;
    varying vec2 vUv;

    vec3 applySaturation(vec3 color, float amount) {
      float luminance = dot(color, vec3(0.299, 0.587, 0.114));
      return mix(vec3(luminance), color, amount);
    }

    ${CAS_GLSL_SNIPPET}

    void main() {
      vec2 centeredUv = vUv - vec2(0.5);
      float radius = length(centeredUv);
      vec2 warpedUv = clamp(vUv + centeredUv * radius * pulseWarp, 0.0, 1.0);
      vec2 chromaUvOffset = vec2(chromaOffset) / max(resolution, vec2(1.0));

      vec4 baseColor = texture2D(tDiffuse, warpedUv);
      vec4 chromaColor = vec4(
        texture2D(tDiffuse, clamp(warpedUv + chromaUvOffset, 0.0, 1.0)).r,
        baseColor.g,
        texture2D(tDiffuse, clamp(warpedUv - chromaUvOffset, 0.0, 1.0)).b,
        baseColor.a
      );

      // Contrast-Adaptive Sharpening for edge reconstruction on downscaled/feedback buffers
      vec3 sharpenedColor = applyContrastAdaptiveSharpening(tDiffuse, warpedUv, resolution, casSharpness);
      if (chromaOffset != 0.0) {
        sharpenedColor = mix(sharpenedColor, chromaColor.rgb, 0.5);
      }

      float vignetteRadius = clamp(1.0 - vignetteStrength * 0.65, 0.15, 1.0);
      float vignette = smoothstep(
        vignetteRadius,
        vignetteRadius - 0.28,
        radius
      );

      vec3 color = mix(sharpenedColor, sharpenedColor * vignette, vignetteStrength);
      color = applySaturation(color, saturation);
      color = (color - 0.5) * contrast + 0.5;
      gl_FragColor = vec4(color, chromaColor.a);
    }
  `,
};

export function isWebGLRenderer(renderer: unknown): renderer is WebGLRenderer {
  return (
    !!renderer &&
    typeof renderer === 'object' &&
    'capabilities' in renderer &&
    'extensions' in renderer
  );
}

export function supportsWebGLPostprocessing(
  backend: RendererBackend | null | undefined,
): boolean {
  return backend === 'webgl';
}

export function resolveWebGLRenderer(
  backend: RendererBackend | null | undefined,
  renderer: unknown,
): WebGLRenderer | null {
  if (!supportsWebGLPostprocessing(backend)) {
    return null;
  }
  return isWebGLRenderer(renderer) ? renderer : null;
}

export function shouldEnableMilkdropPostprocessingProfile(
  profile: MilkdropPostprocessingProfile | null | undefined,
) {
  return Boolean(profile?.enabled);
}

export function shouldRenderMilkdropPostprocessing({
  backend,
  renderer,
  profile,
}: {
  backend: RendererBackend | null | undefined;
  renderer: unknown;
  profile: MilkdropPostprocessingProfile | null | undefined;
}) {
  return (
    supportsWebGLPostprocessing(backend) &&
    shouldEnableMilkdropPostprocessingProfile(profile) &&
    isWebGLRenderer(renderer)
  );
}

export function createMilkdropPostprocessingComposer({
  renderer,
  scene,
  camera,
  profile,
}: {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: Camera;
  profile: MilkdropPostprocessingProfile;
}): PostprocessingPipeline | null {
  if (!shouldEnableMilkdropPostprocessingProfile(profile)) {
    return null;
  }

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const size = renderer.getSize(new Vector2());
  const mobile = isMobileDevice();
  const lowPower = getDevicePerformanceProfile().lowPower;
  const downscaleBloom = mobile || lowPower;

  // Bloom and afterimage are created lazily on the first profile that needs
  // them (they allocate render targets, so don't pay for presets that never
  // enable them) — but they MUST be creatable after construction: profiles
  // are per-preset and audio-driven, and the composer is usually built on an
  // early quiet frame whose profile zeroes both. The old create-only-at-
  // construction gating silently dropped afterimage (and bloom) for the rest
  // of the session.
  let bloomPass: UnrealBloomPass | undefined;
  const ensureBloomPass = (nextProfile: MilkdropPostprocessingProfile) => {
    if (bloomPass || nextProfile.bloomStrength <= 0) return;
    const bloomSize = downscaleBloom
      ? new Vector2(Math.round(lastSize.x / 2), Math.round(lastSize.y / 2))
      : new Vector2(lastSize.x, lastSize.y);
    bloomPass = new UnrealBloomPass(
      bloomSize,
      nextProfile.bloomStrength,
      nextProfile.bloomRadius,
      nextProfile.bloomThreshold,
    );
    composer.insertPass(bloomPass, composer.passes.indexOf(filmPass));
  };

  const filmPass = new FilmPass() as FilmPassWithUniforms;
  composer.addPass(filmPass);

  let afterimagePass: AfterimagePass | undefined;
  const ensureAfterimagePass = (nextProfile: MilkdropPostprocessingProfile) => {
    if (afterimagePass || nextProfile.afterimageDamp <= 0) return;
    afterimagePass = new AfterimagePass(
      Math.max(nextProfile.afterimageDamp, 0),
    );
    afterimagePass.enabled = true;
    composer.insertPass(afterimagePass, composer.passes.indexOf(chromaPass));
  };

  const chromaPass = new ShaderPass(MILKDROP_POSTPROCESSING_SHADER);
  setUniformValue(
    chromaPass.material.uniforms,
    'vignetteStrength',
    profile.vignetteStrength,
  );
  setUniformValue(
    chromaPass.material.uniforms,
    'chromaOffset',
    profile.chromaOffset,
  );
  chromaPass.renderToScreen = true;
  composer.addPass(chromaPass);

  const lastSize = size.clone();
  const sizeScratch = new Vector2();
  chromaPass.material.uniforms.resolution?.value?.set?.(size.x, size.y);

  const applyProfile = (nextProfile: MilkdropPostprocessingProfile) => {
    ensureBloomPass(nextProfile);
    ensureAfterimagePass(nextProfile);
    if (bloomPass) {
      bloomPass.strength = nextProfile.bloomStrength;
      bloomPass.radius = nextProfile.bloomRadius;
      bloomPass.threshold = nextProfile.bloomThreshold;
      // UnrealBloom is ~11 full-screen passes even at zero strength; disable
      // it (and the film pass) outright when the profile zeroes them, the
      // same way afterimage is gated below.
      bloomPass.enabled = nextProfile.bloomStrength > 0;
    }
    setUniformValue(filmPass.uniforms, 'nIntensity', nextProfile.filmNoise);
    setUniformValue(filmPass.uniforms, 'sIntensity', nextProfile.filmScanlines);
    setUniformValue(filmPass.uniforms, 'sCount', nextProfile.filmScanlineCount);
    filmPass.enabled =
      nextProfile.filmNoise > 0 || nextProfile.filmScanlines > 0;
    if (afterimagePass) {
      afterimagePass.damp = Math.max(nextProfile.afterimageDamp, 0);
      afterimagePass.enabled = nextProfile.afterimageDamp > 0;
    }
    setUniformValue(
      chromaPass.material.uniforms,
      'vignetteStrength',
      nextProfile.vignetteStrength,
    );
    setUniformValue(
      chromaPass.material.uniforms,
      'chromaOffset',
      nextProfile.chromaOffset,
    );
    setUniformValue(
      chromaPass.material.uniforms,
      'saturation',
      nextProfile.saturation,
    );
    setUniformValue(
      chromaPass.material.uniforms,
      'contrast',
      nextProfile.contrast,
    );
    setUniformValue(
      chromaPass.material.uniforms,
      'pulseWarp',
      nextProfile.pulseWarp,
    );
  };
  applyProfile(profile);

  const updateSize = () => {
    renderer.getSize(sizeScratch);
    if (sizeScratch.x !== lastSize.x || sizeScratch.y !== lastSize.y) {
      composer.setSize(sizeScratch.x, sizeScratch.y);
      if (bloomPass && mobile) {
        bloomPass.resolution.set(
          Math.round(sizeScratch.x / 2),
          Math.round(sizeScratch.y / 2),
        );
      }
      chromaPass.material.uniforms.resolution?.value?.set?.(
        sizeScratch.x,
        sizeScratch.y,
      );
      lastSize.copy(sizeScratch);
    }
  };

  return {
    composer,
    // Getters: both passes can come into existence on a later applyProfile.
    get bloomPass() {
      return bloomPass;
    },
    get afterimagePass() {
      return afterimagePass;
    },
    filmPass,
    chromaPass,
    applyProfile,
    render: () => composer.render(),
    updateSize,
    dispose: () => {
      bloomPass?.dispose();
      afterimagePass?.dispose();
      composer.dispose();
    },
  };
}

export function createBloomComposer({
  renderer,
  scene,
  camera,
  bloomStrength,
  bloomRadius = 0.4,
  bloomThreshold = 0.85,
}: {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: Camera;
  bloomStrength: number;
  bloomRadius?: number;
  bloomThreshold?: number;
}): PostprocessingPipeline {
  const profile: MilkdropPostprocessingProfile = {
    enabled: true,
    bloomStrength,
    bloomRadius,
    bloomThreshold,
    afterimageDamp: 0,
    filmNoise: 0,
    filmScanlines: 0,
    filmScanlineCount: 0,
    vignetteStrength: 0,
    chromaOffset: 0,
    saturation: 1,
    contrast: 1,
    pulseWarp: 0,
  };
  const pipeline = createMilkdropPostprocessingComposer({
    renderer,
    scene,
    camera,
    profile,
  });

  if (!pipeline) {
    throw new Error('Bloom composer profile should always be enabled.');
  }

  return pipeline;
}
