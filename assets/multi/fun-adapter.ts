import * as THREE from 'three';
import type { PaletteOption } from '../ui/fun-controls';

interface MultiAdapterOptions {
  torusMaterial: THREE.MeshStandardMaterial;
  pointLight: THREE.PointLight;
  particlesMaterial: THREE.PointsMaterial;
  shapes: THREE.Mesh[];
}

export const multiPalettes: Record<PaletteOption, string[]> = {
  bright: ['#ff6b6b', '#ffd166', '#00d1ff'],
  pastel: ['#d7c0ae', '#a5d8ff', '#f8edeb'],
  neon: ['#39ff14', '#ff00a0', '#00fff2'],
};

export function createMultiFunAdapter({
  torusMaterial,
  pointLight,
  particlesMaterial,
  shapes,
}: MultiAdapterOptions) {
  let motionIntensity = 0.6;
  let mode: 'calm' | 'party' = 'calm';
  let audioReactive = true;
  let currentPalette: PaletteOption = 'bright';

  function recolorShapes(colors: string[]) {
    const materials = colors.map(
      (color) =>
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.2,
          metalness: 0.6,
          roughness: 0.35,
        })
    );

    shapes.forEach((shape, idx) => {
      shape.material = materials[idx % materials.length];
    });
  }

  function setPalette(palette: PaletteOption, colors: string[]) {
    currentPalette = palette;
    torusMaterial.color = new THREE.Color(colors[0]);
    particlesMaterial.color = new THREE.Color(colors[1]);
    pointLight.color = new THREE.Color(colors[2]);
    recolorShapes(colors);
  }

  function computeMotion(avgFrequency: number) {
    const reactiveValue = audioReactive ? avgFrequency : 45;
    const baseSpin = 0.0015 + reactiveValue / 8000;
    const motionScale = 0.5 + motionIntensity * 1.2;
    const modeScale = mode === 'party' ? 1.6 : 0.85;
    return baseSpin * motionScale * modeScale;
  }

  return {
    paletteOptions: multiPalettes,
    setPalette,
    setMotion(intensity: number, nextMode: 'calm' | 'party') {
      motionIntensity = intensity;
      mode = nextMode;
    },
    setAudioReactive(enabled: boolean) {
      audioReactive = enabled;
    },
    computeMotion,
    get palette() {
      return currentPalette;
    },
  };
}
