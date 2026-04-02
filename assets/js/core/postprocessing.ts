import type { Camera, Scene, WebGLRenderer } from 'three';
import { Vector2 } from 'three';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { FilmPass } from 'three/examples/jsm/postprocessing/FilmPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
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

const MILKDROP_POSTPROCESSING_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new Vector2(1, 1) },
    vignetteStrength: { value: 0 },
    chromaOffset: { value: 0 },
    saturation: { value: 1 },
    contrast: { value: 1 },
    pulseWarp: { value: 0 },
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
    varying vec2 vUv;

    vec3 applySaturation(vec3 color, float amount) {
      float luminance = dot(color, vec3(0.299, 0.587, 0.114));
      return mix(vec3(luminance), color, amount);
    }

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

      float vignetteRadius = clamp(1.0 - vignetteStrength * 0.65, 0.15, 1.0);
      float vignette = smoothstep(
        vignetteRadius,
        vignetteRadius - 0.28,
        radius
      );

      vec3 color = mix(chromaColor.rgb, chromaColor.rgb * vignette, vignetteStrength);
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
  const bloomPass = new UnrealBloomPass(
    new Vector2(size.x, size.y),
    profile.bloomStrength,
    profile.bloomRadius,
    profile.bloomThreshold,
  );
  composer.addPass(bloomPass);

  const filmPass = new FilmPass() as FilmPassWithUniforms;
  composer.addPass(filmPass);

  const afterimagePass = new AfterimagePass(
    Math.max(profile.afterimageDamp, 0),
  );
  afterimagePass.enabled = profile.afterimageDamp > 0;
  composer.addPass(afterimagePass);

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
    bloomPass.strength = nextProfile.bloomStrength;
    bloomPass.radius = nextProfile.bloomRadius;
    bloomPass.threshold = nextProfile.bloomThreshold;
    setUniformValue(filmPass.uniforms, 'nIntensity', nextProfile.filmNoise);
    setUniformValue(filmPass.uniforms, 'sIntensity', nextProfile.filmScanlines);
    setUniformValue(filmPass.uniforms, 'sCount', nextProfile.filmScanlineCount);
    afterimagePass.damp = Math.max(nextProfile.afterimageDamp, 0);
    afterimagePass.enabled = nextProfile.afterimageDamp > 0;
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
      chromaPass.material.uniforms.resolution?.value?.set?.(
        sizeScratch.x,
        sizeScratch.y,
      );
      lastSize.copy(sizeScratch);
    }
  };

  return {
    composer,
    bloomPass,
    afterimagePass,
    filmPass,
    chromaPass,
    applyProfile,
    render: () => composer.render(),
    updateSize,
    dispose: () => {
      afterimagePass.dispose();
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
