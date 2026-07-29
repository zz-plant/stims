/**
 * AI EEL Preset Synthesizer
 *
 * Generates valid MilkDrop EEL preset code blocks (per_frame, per_pixel, wavecode, shapecode)
 * from text prompts and visual theme parameters.
 */

export interface SynthesizedMilkdropPreset {
  id: string;
  name: string;
  author: string;
  decay: number;
  zoom: number;
  rot: number;
  warp: number;
  wave_r: number;
  wave_g: number;
  wave_b: number;
  per_frame: string;
  per_pixel: string;
  wavecode_0_per_point?: string;
  shapecode_0_per_frame?: string;
}

export interface PresetSynthesisOptions {
  prompt: string;
  intensity?: number; // 0.0 - 2.0
  beatReactivity?: number; // 0.0 - 2.0
  colorPalette?:
    | 'bioluminescent'
    | 'cyberpunk'
    | 'cosmic'
    | 'monochrome'
    | 'auto';
}

const THEME_TEMPLATES: Record<string, Partial<SynthesizedMilkdropPreset>> = {
  bioluminescent: {
    decay: 0.98,
    zoom: 1.02,
    rot: 0.01,
    warp: 0.05,
    wave_r: 0.1,
    wave_g: 0.9,
    wave_b: 0.7,
    per_frame: `
      wave_r = 0.2 + 0.8 * sin(time * 0.4);
      wave_g = 0.5 + 0.5 * cos(time * 0.7);
      wave_b = 0.7 + 0.3 * sin(bass * 2.0);
      zoom = 1.0 + 0.04 * bass_att;
      rot = 0.02 * sin(time * 0.3);
    `.trim(),
    per_pixel: `
      dx = (x - 0.5) * 0.02 * sin(rad * 8.0 + time);
      dy = (y - 0.5) * 0.02 * cos(rad * 8.0 + time);
      rot = rot + 0.03 * sin(rad * 12.0 - time * 2.0);
    `.trim(),
  },
  cyberpunk: {
    decay: 0.94,
    zoom: 1.05,
    rot: -0.02,
    warp: 0.2,
    wave_r: 0.95,
    wave_g: 0.05,
    wave_b: 0.6,
    per_frame: `
      wave_r = 0.9 + 0.1 * sin(time * 1.2);
      wave_g = 0.05;
      wave_b = 0.6 + 0.4 * cos(treb * 3.0);
      zoom = 1.02 + 0.06 * treb_att;
      warp = 0.1 + 0.3 * bass;
    `.trim(),
    per_pixel: `
      zoom = zoom + 0.05 * sin(ang * 6.0 + time * 3.0);
      rot = rot + 0.04 * cos(x * 10.0 + time);
    `.trim(),
  },
  cosmic: {
    decay: 0.99,
    zoom: 0.99,
    rot: 0.005,
    warp: 0.02,
    wave_r: 0.8,
    wave_g: 0.4,
    wave_b: 1.0,
    per_frame: `
      wave_r = 0.6 + 0.4 * sin(time * 0.2);
      wave_g = 0.3 + 0.3 * cos(time * 0.5);
      wave_b = 0.9;
      zoom = 0.995 + 0.02 * mid_att;
      rot = 0.008 * cos(time * 0.25);
    `.trim(),
    per_pixel: `
      rot = rot + 0.01 * sin(rad * 4.0 + time);
      cx = 0.5 + 0.1 * sin(time * 0.5);
      cy = 0.5 + 0.1 * cos(time * 0.5);
    `.trim(),
  },
  default: {
    decay: 0.97,
    zoom: 1.01,
    rot: 0.01,
    warp: 0.08,
    wave_r: 0.5,
    wave_g: 0.6,
    wave_b: 0.9,
    per_frame: `
      wave_r = 0.5 + 0.5 * sin(time * 0.5);
      wave_g = 0.5 + 0.5 * cos(time * 0.6);
      wave_b = 0.5 + 0.5 * sin(bass * 1.5);
      zoom = 1.0 + 0.03 * bass_att;
    `.trim(),
    per_pixel: `
      rot = rot + 0.02 * sin(rad * 6.0 + time);
    `.trim(),
  },
};

export function synthesizeEELPreset(
  options: PresetSynthesisOptions,
): SynthesizedMilkdropPreset {
  const promptLower = options.prompt.toLowerCase();
  const intensity = options.intensity ?? 1.0;
  const reactivity = options.beatReactivity ?? 1.0;

  let chosenPalette = options.colorPalette ?? 'auto';
  if (chosenPalette === 'auto') {
    if (
      promptLower.includes('bioluminescent') ||
      promptLower.includes('sea') ||
      promptLower.includes('glow')
    ) {
      chosenPalette = 'bioluminescent';
    } else if (
      promptLower.includes('cyberpunk') ||
      promptLower.includes('neon') ||
      promptLower.includes('synth')
    ) {
      chosenPalette = 'cyberpunk';
    } else if (
      promptLower.includes('cosmic') ||
      promptLower.includes('space') ||
      promptLower.includes('star')
    ) {
      chosenPalette = 'cosmic';
    } else {
      chosenPalette = 'bioluminescent';
    }
  }

  const base = THEME_TEMPLATES[chosenPalette] ?? THEME_TEMPLATES.default;

  const id = `ai-synth-${Date.now().toString(36)}`;
  const cleanPromptTitle =
    options.prompt.trim().slice(0, 40) || 'AI Synthesized Visualizer';

  return {
    id,
    name: `AI: ${cleanPromptTitle}`,
    author: 'Stims AI Preset Synthesizer',
    decay: base.decay ?? 0.97,
    zoom: 1.0 + ((base.zoom ?? 1.01) - 1.0) * intensity,
    rot: (base.rot ?? 0.01) * intensity,
    warp: (base.warp ?? 0.05) * intensity,
    wave_r: base.wave_r ?? 0.5,
    wave_g: base.wave_g ?? 0.5,
    wave_b: base.wave_b ?? 0.9,
    per_frame: base.per_frame
      ? base.per_frame.replace(/bass_att/g, `(${reactivity} * bass_att)`)
      : 'zoom = 1.01;',
    per_pixel: base.per_pixel ?? 'rot = 0.01;',
    wavecode_0_per_point: 'x = sample; y = 0.5 + value1 * 0.2;',
  };
}
