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

export const searyPalettes: Record<PaletteOption, string[]> = {
  bright: ['#ff6b6b', '#ffd166', '#6c5ce7'],
  pastel: ['#f6e7cb', '#cce2f1', '#e2cfea'],
  neon: ['#39ff14', '#ff00f0', '#00e5ff'],
};

type FrequencyTriple = {
  low: number;
  mid: number;
  high: number;
};

export function createSearyFunAdapter() {
  let paletteAccent: readonly number[] = toVec3(searyPalettes.bright[0]);
  let motionIntensity = 0.6;
  let mode: 'calm' | 'party' = 'calm';
  let audioReactive = true;

  function setPalette(_palette: PaletteOption, colors: string[]) {
    paletteAccent = toVec3(colors[0]);
  }

  function transformFrequencies(values: FrequencyTriple) {
    const base = audioReactive ? values : { low: 0.25, mid: 0.2, high: 0.15 };
    const motionBoost = 0.6 + motionIntensity * 1.4;
    const modeBoost = mode === 'party' ? 1.5 : 0.95;
    return {
      low: base.low * motionBoost * modeBoost,
      mid: base.mid * motionBoost * modeBoost,
      high: base.high * motionBoost * modeBoost,
    };
  }

  return {
    paletteOptions: searyPalettes,
    setPalette,
    setMotion(intensity: number, nextMode: 'calm' | 'party') {
      motionIntensity = intensity;
      mode = nextMode;
    },
    setAudioReactive(enabled: boolean) {
      audioReactive = enabled;
    },
    transformFrequencies,
    get paletteAccent() {
      return paletteAccent;
    },
  };
}
