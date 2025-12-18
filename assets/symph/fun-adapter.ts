import {
  FUN_PALETTES,
  type MotionMode,
  type PaletteName,
} from '../ui/fun-controls';

interface SymphAdapterConfig {
  gl: WebGLRenderingContext;
  colorOffsetLocation: WebGLUniformLocation | null;
}

function hexToVec3(hex: string): [number, number, number] {
  const num = parseInt(hex.replace('#', ''), 16);
  return [
    ((num >> 16) & 255) / 255,
    ((num >> 8) & 255) / 255,
    (num & 255) / 255,
  ];
}

export function createSymphAdapter(config: SymphAdapterConfig) {
  let motionIntensity = 0.6;
  let motionMode: MotionMode = 'calm';
  let audioReactive = true;
  let palette: PaletteName = 'bright';

  function applyPalette(name: PaletteName) {
    palette = name;
    const tint = hexToVec3(FUN_PALETTES[name][2]);
    if (config.colorOffsetLocation) {
      config.gl.uniform3fv(config.colorOffsetLocation, tint);
    }
  }

  function setMotion(intensity: number, mode: MotionMode) {
    motionIntensity = intensity;
    motionMode = mode;
  }

  function setAudioReactive(enabled: boolean) {
    audioReactive = enabled;
  }

  function transformAudioData(raw: number) {
    const base = 0.55 + motionIntensity * 0.9;
    const modeBoost = motionMode === 'party' ? 1.5 : 1;
    if (!audioReactive) {
      return base * modeBoost * 0.8;
    }
    return raw * base * modeBoost;
  }

  function getPaletteName() {
    return palette;
  }

  return {
    applyPalette,
    setMotion,
    setAudioReactive,
    transformAudioData,
    getPaletteName,
  };
}
