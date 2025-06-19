import * as THREE from 'three';

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
  scene: THREE.Scene,
  config: LightConfig = {
    type: 'PointLight',
    color: 0xffffff,
    intensity: 1,
    position: { x: 10, y: 10, z: 10 },
    castShadow: false,
  }
): void {
  let light: THREE.Light;

  switch (config.type) {
    case 'DirectionalLight':
      light = new THREE.DirectionalLight(config.color, config.intensity);
      light.position.set(
        config.position.x,
        config.position.y,
        config.position.z
      );
      if (config.castShadow) {
        light.castShadow = true;
      }
      break;
    case 'SpotLight':
      light = new THREE.SpotLight(config.color, config.intensity);
      light.position.set(
        config.position.x,
        config.position.y,
        config.position.z
      );
      if (config.castShadow) {
        light.castShadow = true;
      }
      break;
    case 'HemisphereLight':
      light = new THREE.HemisphereLight(
        config.color,
        0x444444,
        config.intensity
      );
      break;
    default:
      light = new THREE.PointLight(config.color, config.intensity);
      light.position.set(
        config.position.x,
        config.position.y,
        config.position.z
      );
      if (config.castShadow) {
        light.castShadow = true;
      }
      break;
  }

  scene.add(light);
}

export function initAmbientLight(
  scene: THREE.Scene,
  config: AmbientLightConfig = { color: 0x404040, intensity: 0.5 }
): void {
  const ambientLight = new THREE.AmbientLight(config.color, config.intensity);
  scene.add(ambientLight);
}
