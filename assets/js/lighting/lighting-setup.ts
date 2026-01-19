import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  PointLight,
  type Scene,
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

type SceneLike = Pick<Scene, 'add'>;
type LightingInstance =
  | DirectionalLight
  | SpotLight
  | HemisphereLight
  | PointLight;

type LightingConstructors = {
  DirectionalLight: typeof DirectionalLight;
  SpotLight: typeof SpotLight;
  HemisphereLight: typeof HemisphereLight;
  PointLight: typeof PointLight;
};

export function initLighting(
  scene: SceneLike,
  config: LightConfig = {
    type: 'PointLight',
    color: 0xffffff,
    intensity: 1,
    position: { x: 10, y: 10, z: 10 },
    castShadow: false,
  },
  constructors: LightingConstructors = {
    DirectionalLight,
    SpotLight,
    HemisphereLight,
    PointLight,
  },
): void {
  const {
    type = 'PointLight',
    color = 0xffffff,
    intensity = 1,
    position,
    castShadow = false,
  } = config ?? {};

  const { x, y, z } = { x: 10, y: 10, z: 10, ...(position ?? {}) };
  const {
    DirectionalLight: DirectionalLightConstructor,
    SpotLight: SpotLightConstructor,
    HemisphereLight: HemisphereLightConstructor,
    PointLight: PointLightConstructor,
  } = constructors;
  let light: LightingInstance;

  switch (type) {
    case 'DirectionalLight':
      light = new DirectionalLightConstructor(color, intensity);
      light.position.set(x, y, z);
      if (castShadow) {
        light.castShadow = true;
      }
      break;
    case 'SpotLight':
      light = new SpotLightConstructor(color, intensity);
      light.position.set(x, y, z);
      if (castShadow) {
        light.castShadow = true;
      }
      break;
    case 'HemisphereLight':
      light = new HemisphereLightConstructor(color, 0x444444, intensity);
      break;
    default:
      light = new PointLightConstructor(color, intensity);
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
): void {
  const ambientLight = new AmbientLight(config.color, config.intensity);
  scene.add(ambientLight);
}
