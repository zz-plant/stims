import * as THREE from 'three';
import type { MotionMode, PaletteName } from '../ui/fun-controls';
import { FUN_PALETTES } from '../ui/fun-controls';

interface MultiAdapterConfig {
  torusMaterial: THREE.MeshStandardMaterial;
  particlesMaterial: THREE.PointsMaterial;
  shapes: THREE.Mesh[];
  pointLight: THREE.PointLight;
}

export function createMultiAdapter(config: MultiAdapterConfig) {
  let motionIntensity = 0.6;
  let motionMode: MotionMode = 'calm';
  let audioReactive = true;

  function applyPalette(name: PaletteName) {
    const colors = FUN_PALETTES[name];
    config.torusMaterial.color = new THREE.Color(colors[0]);
    config.torusMaterial.emissive = new THREE.Color(colors[1]);
    config.particlesMaterial.color = new THREE.Color(colors[2]);
    config.shapes.forEach((shape, index) => {
      const mat = shape.material as THREE.MeshStandardMaterial;
      mat.color = new THREE.Color(colors[(index + 3) % colors.length]);
      mat.emissive = new THREE.Color(colors[(index + 1) % colors.length]);
    });
  }

  function setMotion(intensity: number, mode: MotionMode) {
    motionIntensity = intensity;
    motionMode = mode;
  }

  function setAudioReactive(enabled: boolean) {
    audioReactive = enabled;
  }

  function getMotionValues(avgFrequency: number) {
    const baseRotation = 0.0025 + motionIntensity * 0.01;
    const modeBoost = motionMode === 'party' ? 1.6 : 0.9;
    const reactive = audioReactive
      ? avgFrequency / 5000
      : 0.01 * motionIntensity;
    const lightBoost = audioReactive
      ? Math.max(0.6, avgFrequency / 80)
      : 0.8 + motionIntensity * 0.8;
    return {
      rotationStep: (baseRotation + reactive) * modeBoost,
      particleSpin: 0.0008 + motionIntensity * 0.003,
      shapeAdvance: 0.4 + motionIntensity * 1.2,
      lightIntensity: lightBoost * modeBoost,
    };
  }

  return { applyPalette, setMotion, setAudioReactive, getMotionValues };
}
