export interface Theme {
  name: string;
  hueOffset: number;
  satFloor: number;
  satScale: number;
  lightMin: number;
  lightMax: number;
  lightCurve: (t: number) => number;
}

const themes: Record<string, Theme> = {
  cyberpunk: {
    name: 'cyberpunk',
    hueOffset: 290,
    satFloor: 0.65,
    satScale: 0.35,
    lightMin: 0.15,
    lightMax: 0.65,
    lightCurve: (t) => 1 - (1 - t) ** 2,
  },
  ocean: {
    name: 'ocean',
    hueOffset: 195,
    satFloor: 0.55,
    satScale: 0.45,
    lightMin: 0.2,
    lightMax: 0.7,
    lightCurve: (t) => Math.sin(t * Math.PI) * 0.8 + 0.2,
  },
  neon: {
    name: 'neon',
    hueOffset: 140,
    satFloor: 0.85,
    satScale: 0.15,
    lightMin: 0.3,
    lightMax: 0.85,
    lightCurve: (t) => t ** 3,
  },
  fire: {
    name: 'fire',
    hueOffset: 12,
    satFloor: 0.7,
    satScale: 0.3,
    lightMin: 0.1,
    lightMax: 0.75,
    lightCurve: (t) => t ** 0.5,
  },
  midnight: {
    name: 'midnight',
    hueOffset: 250,
    satFloor: 0.4,
    satScale: 0.5,
    lightMin: 0.05,
    lightMax: 0.4,
    lightCurve: (t) => t * 0.6 + 0.1,
  },
  forest: {
    name: 'forest',
    hueOffset: 80,
    satFloor: 0.5,
    satScale: 0.4,
    lightMin: 0.1,
    lightMax: 0.55,
    lightCurve: (t) => 1 - Math.abs(t - 0.5) * 2 * 0.7,
  },
  sunset: {
    name: 'sunset',
    hueOffset: 25,
    satFloor: 0.6,
    satScale: 0.4,
    lightMin: 0.15,
    lightMax: 0.7,
    lightCurve: (t) => t ** 1.5,
  },
};

export function getTheme(name: string): Theme {
  return themes[name] ?? themes.cyberpunk!;
}

export function themeNames(): string[] {
  return Object.keys(themes);
}

export function applyTheme(
  theme: Theme,
  hue: number,
  value: number,
): {
  h: number;
  s: number;
  l: number;
} {
  const h = (((hue + theme.hueOffset) % 360) + 360) % 360;
  const s = theme.satFloor + theme.satScale * (1 - value * 0.4);
  const t = Math.max(0, Math.min(1, value));
  const l =
    theme.lightMin + theme.lightCurve(t) * (theme.lightMax - theme.lightMin);
  return { h, s, l };
}
