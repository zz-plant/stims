import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  Light,
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

// Initialize a point light with configurable options
export function initLighting(
  scene: Scene,
  config: LightConfig = {
    type: 'PointLight',
    color: 0xffffff,
    intensity: 1,
    position: { x: 10, y: 10, z: 10 },
    castShadow: false,
  }
): void {
  const {
    type = 'PointLight',
    color = 0xffffff,
    intensity = 1,
    position = { x: 10, y: 10, z: 10 },
    castShadow = false,
  } = config ?? {};

  const { x = 0, y = 0, z = 0 } = position ?? {};
  let light: Light;

  switch (type) {
    case 'DirectionalLight':
      light = new DirectionalLight(color, intensity);
      light.position.set(x, y, z);
      if (castShadow) {
        light.castShadow = true;
      }
      break;
    case 'SpotLight':
      light = new SpotLight(color, intensity);
      light.position.set(x, y, z);
      if (castShadow) {
        light.castShadow = true;
      }
      break;
    case 'HemisphereLight':
      light = new HemisphereLight(color, 0x444444, intensity);
      break;
    default:
      light = new PointLight(color, intensity);
      light.position.set(x, y, z);
      if (castShadow) {
        light.castShadow = true;
      }
      break;
  }

  scene.add(light);
}

export function initAmbientLight(
  scene: Scene,
  config: AmbientLightConfig = { color: 0x404040, intensity: 0.5 }
): void {
  const ambientLight = new AmbientLight(config.color, config.intensity);
  scene.add(ambientLight);
}
