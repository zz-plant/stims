import * as THREE from 'three';
import type { PaletteOption } from '../ui/fun-controls';

type InstancedMesh = THREE.InstancedMesh<
  THREE.BufferGeometry,
  THREE.Material
> & {
  instanceColor?: THREE.InstancedBufferAttribute;
  count: number;
};

export const brandPalettes: Record<PaletteOption, string[]> = {
  bright: ['#ff6b6b', '#ffd166', '#4d9de0'],
  pastel: ['#d8a7b1', '#c7e2d0', '#f6eec7'],
  neon: ['#39ff14', '#ff00a0', '#00d1ff'],
};

interface BrandAdapterOptions {
  buildingMesh: InstancedMesh;
  treeMaterial: THREE.MeshLambertMaterial;
  poleMaterial: THREE.MeshLambertMaterial;
}

export function createBrandFunAdapter({
  buildingMesh,
  treeMaterial,
  poleMaterial,
}: BrandAdapterOptions) {
  let motionIntensity = 0.6;
  let partyMode: 'calm' | 'party' = 'calm';
  let audioReactive = true;

  function applyPalette(_palette: PaletteOption, colors: string[]) {
    const [primary, secondary, accent] = colors;

    for (let i = 0; i < buildingMesh.count; i += 1) {
      const color = new THREE.Color(primary).offsetHSL(
        0,
        0,
        (Math.random() - 0.5) * 0.08
      );
      buildingMesh.instanceColor?.setXYZ(i, color.r, color.g, color.b);
    }
    if (buildingMesh.instanceColor) {
      buildingMesh.instanceColor.needsUpdate = true;
    }

    treeMaterial.color = new THREE.Color(secondary);
    poleMaterial.color = new THREE.Color(accent);
  }

  function computeSpeed(bass: number) {
    const reactiveBass = audioReactive ? bass : 30;
    const motionBoost = 0.6 + motionIntensity * 1.2;
    const partyBoost = partyMode === 'party' ? 1.4 : 0.9;
    return (0.25 + reactiveBass / 120) * motionBoost * partyBoost;
  }

  return {
    paletteOptions: brandPalettes,
    setPalette: applyPalette,
    setMotion(intensity: number, mode: 'calm' | 'party') {
      motionIntensity = intensity;
      partyMode = mode;
    },
    setAudioReactive(enabled: boolean) {
      audioReactive = enabled;
    },
    computeSpeed,
  };
}
