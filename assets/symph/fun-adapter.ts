import type { PaletteOption } from '../ui/fun-controls';

const toVec3 = (hex: string) => {
  const value = hex.startsWith('#') ? hex.slice(1) : hex;
  const int = parseInt(value, 16);
  return [
    ((int >> 16) & 255) / 255,
    ((int >> 8) & 255) / 255,
    (int & 255) / 255,
  ] as const;
};

export const symphPalettes: Record<PaletteOption, string[]> = {
  bright: ['#ff6b6b', '#ffd166', '#6c5ce7'],
  pastel: ['#f6e7cb', '#cce2f1', '#d0f4de'],
  neon: ['#39ff14', '#ff00f0', '#00e5ff'],
};

export function createSymphFunAdapter() {
  let paletteAccent: readonly number[] = toVec3(symphPalettes.bright[2]);
  let motionIntensity = 0.6;
  let mode: 'calm' | 'party' = 'calm';
  let audioReactive = true;

  function setPalette(_palette: PaletteOption, colors: string[]) {
    paletteAccent = toVec3(colors[2]);
  }

  function transformAudioValue(value: number) {
    const base = audioReactive ? value : 42;
    const motionBoost = 0.6 + motionIntensity * 1.4;
    const modeBoost = mode === 'party' ? 1.6 : 0.95;
    return (base / 255) * motionBoost * modeBoost;
  }

  return {
    paletteOptions: symphPalettes,
    setPalette,
    setMotion(intensity: number, nextMode: 'calm' | 'party') {
      motionIntensity = intensity;
      mode = nextMode;
    },
    setAudioReactive(enabled: boolean) {
      audioReactive = enabled;
    },
    transformAudioValue,
    get paletteAccent() {
      return paletteAccent;
    },
  };
}
