import type {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  PointLight,
  Scene,
  SpotLight,
} from 'three';

export interface LightConfig {
  type?: 'DirectionalLight' | 'SpotLight' | 'HemisphereLight' | 'PointLight';
  color?: number | string;
  intensity?: number;
  position?: { x: number; y: number; z: number };
  castShadow?: boolean;
}

export interface AmbientLightConfig {
  color?: number | string;
  intensity?: number;
}

type LightingModule = {
  DirectionalLight: typeof DirectionalLight;
  SpotLight: typeof SpotLight;
  HemisphereLight: typeof HemisphereLight;
  PointLight: typeof PointLight;
};

type AmbientLightingModule = {
  AmbientLight: typeof AmbientLight;
};

type SceneLike = Pick<Scene, 'add'>;
type LightingInstance = InstanceType<LightingModule[keyof LightingModule]>;

export function initLighting(
  scene: SceneLike,
  config: LightConfig = {
    type: 'PointLight',
    color: 0xffffff,
    intensity: 1,
    position: { x: 10, y: 10, z: 10 },
    castShadow: false,
  },
  lighting: LightingModule
): void {
  const {
    type = 'PointLight',
    color = 0xffffff,
    intensity = 1,
    position,
    castShadow = false,
  } = config ?? {};

  const { x, y, z } = { x: 10, y: 10, z: 10, ...(position ?? {}) };
  let light: LightingInstance;

  switch (type) {
    case 'DirectionalLight':
      light = new lighting.DirectionalLight(color, intensity);
      light.position.set(x, y, z);
      if (castShadow) {
        light.castShadow = true;
      }
      break;
    case 'SpotLight':
      light = new lighting.SpotLight(color, intensity);
      light.position.set(x, y, z);
      if (castShadow) {
        light.castShadow = true;
      }
      break;
    case 'HemisphereLight':
      light = new lighting.HemisphereLight(color, 0x444444, intensity);
      break;
    default:
      light = new lighting.PointLight(color, intensity);
      light.position.set(x, y, z);
      if (castShadow) {
        light.castShadow = true;
      }
      break;
  }

  scene.add(light);
}

export function initAmbientLight(
  scene: SceneLike,
  config: AmbientLightConfig = { color: 0x404040, intensity: 0.5 },
  lighting: AmbientLightingModule
): void {
  const ambientLight = new lighting.AmbientLight(
    config.color,
    config.intensity
  );
  scene.add(ambientLight);
}
