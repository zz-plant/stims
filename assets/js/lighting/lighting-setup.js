// lighting-setup.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.module.js';

// Initialize a point light with configurable options
export function initLighting(
  scene,
  config = {
    type: 'PointLight', // Allow different types of lights
    color: 0xffffff,
    intensity: 1,
    position: { x: 10, y: 10, z: 10 },
    castShadow: false, // Enable shadow support
  }
) {
  let light;

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
  scene,
  config = { color: 0x404040, intensity: 0.5 }
) {
  const ambientLight = new THREE.AmbientLight(config.color, config.intensity);
  scene.add(ambientLight);
}
