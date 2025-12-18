import * as THREE from 'three';
import type { MotionMode, PaletteName } from '../ui/fun-controls';
import { FUN_PALETTES } from '../ui/fun-controls';

interface InstanceData {
  x: number;
  z: number;
  scale: number;
  type: string;
}

interface BrandAdapterConfig {
  buildingMesh: THREE.InstancedMesh;
  buildingData: InstanceData[];
  treeMesh: THREE.InstancedMesh;
  poleMesh: THREE.InstancedMesh;
  ground: THREE.Mesh;
}

export function createBrandAdapter(config: BrandAdapterConfig) {
  let motionIntensity = 0.6;
  let motionMode: MotionMode = 'calm';
  let audioReactive = true;

  function paletteColors(name: PaletteName) {
    return FUN_PALETTES[name].map((value) => new THREE.Color(value));
  }

  function applyPalette(name: PaletteName) {
    const colors = paletteColors(name);
    config.buildingData.forEach((_, index) => {
      const color = colors[index % colors.length];
      config.buildingMesh.instanceColor?.setXYZ(
        index,
        color.r,
        color.g,
        color.b
      );
    });
    if (config.buildingMesh.instanceColor) {
      config.buildingMesh.instanceColor.needsUpdate = true;
    }

    const poleMaterial = config.poleMesh.material as THREE.MeshLambertMaterial;
    poleMaterial.color.copy(colors[1 % colors.length]);

    const groundMaterial = config.ground.material as THREE.MeshLambertMaterial;
    groundMaterial.color.copy(colors[2 % colors.length]);

    const treeMaterial = config.treeMesh.material as THREE.MeshLambertMaterial;
    treeMaterial.color.copy(colors[3 % colors.length]);
  }

  function setMotion(intensity: number, mode: MotionMode) {
    motionIntensity = intensity;
    motionMode = mode;
  }

  function setAudioReactive(enabled: boolean) {
    audioReactive = enabled;
  }

  function getSpeedMultiplier(bass: number) {
    const base = 0.6 + motionIntensity * 1.2;
    const modeBoost = motionMode === 'party' ? 1.5 : 0.85;
    const reactiveBoost = audioReactive ? 0.7 + bass / 90 : 1;
    return base * modeBoost * reactiveBoost;
  }

  return { applyPalette, setMotion, setAudioReactive, getSpeedMultiplier };
}
