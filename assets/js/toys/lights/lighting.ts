import * as THREE from 'three';
import WebToy from '../../core/web-toy';

const DEFAULT_RENDERER_OPTIONS = { maxPixelRatio: 2 };

const LIGHT_CONFIGS = {
  PointLight: {
    type: 'PointLight',
    position: { x: 10, y: 10, z: 20 },
    intensity: 1,
  },
  DirectionalLight: {
    type: 'DirectionalLight',
    position: { x: 10, y: 10, z: 20 },
    intensity: 1,
  },
  SpotLight: {
    type: 'SpotLight',
    position: { x: 10, y: 15, z: 18 },
    intensity: 1.25,
  },
  HemisphereLight: {
    type: 'HemisphereLight',
    position: { x: 0, y: 10, z: 0 },
    intensity: 1,
  },
} as const;

export type LightType = keyof typeof LIGHT_CONFIGS;

export type LightsScene = {
  toy: WebToy;
  lightingGroup: THREE.Group;
  cube: THREE.Mesh;
};

export const applyLighting = (
  lightingGroup: THREE.Group,
  lightType: LightType,
) => {
  while (lightingGroup.children.length > 0) {
    lightingGroup.remove(lightingGroup.children[0]);
  }

  const config = LIGHT_CONFIGS[lightType] ?? LIGHT_CONFIGS.PointLight;
  const { type, intensity, position } = config;

  let light: THREE.Light;
  switch (type) {
    case 'DirectionalLight':
      light = new THREE.DirectionalLight(0xffffff, intensity);
      break;
    case 'SpotLight':
      light = new THREE.SpotLight(0xffffff, intensity);
      break;
    case 'HemisphereLight':
      light = new THREE.HemisphereLight(0xffffff, 0x444444, intensity);
      break;
    default:
      light = new THREE.PointLight(0xffffff, intensity);
      break;
  }

  light.position.set(position.x, position.y, position.z);
  lightingGroup.add(light);
};

export const createLightsScene = async ({
  canvas,
  lightType,
  setStatus,
}: {
  canvas: HTMLCanvasElement;
  lightType: LightType;
  setStatus: (message: string, variant?: 'info' | 'error') => void;
}): Promise<LightsScene | null> => {
  let toy: WebToy;

  try {
    toy = new WebToy({
      rendererOptions: DEFAULT_RENDERER_OPTIONS,
      ambientLightOptions: { color: 0x404040, intensity: 0.5 },
      cameraOptions: { position: { x: 0, y: 0, z: 5 } },
      canvas,
    });
  } catch (error) {
    console.error('Unable to create WebToy instance', error);
    setStatus('WebGL support is required to render this visual.', 'error');
    return null;
  }

  const lightingGroup = new THREE.Group();
  toy.scene.add(lightingGroup);
  applyLighting(lightingGroup, lightType);

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial({
      color: 0x00ff00,
      metalness: 0.3,
      roughness: 0.4,
    }),
  );
  toy.scene.add(cube);

  await toy.rendererReady;

  return { toy, lightingGroup, cube };
};
