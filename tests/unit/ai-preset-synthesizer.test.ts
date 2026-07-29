import { describe, expect, it } from 'bun:test';
import { synthesizeEELPreset } from '../../src/js/milkdrop/ai-preset-synthesizer.ts';

describe('AI EEL Preset Synthesizer', () => {
  it('synthesizes valid MilkDrop preset from prompt and parameters', () => {
    const preset = synthesizeEELPreset({
      prompt: 'bioluminescent neon jellyfish pulse',
      intensity: 1.2,
      beatReactivity: 1.5,
    });

    expect(preset.name).toContain('bioluminescent');
    expect(preset.per_frame).toContain('wave_r');
    expect(preset.per_pixel).toContain('rot');
    expect(preset.wavecode_0_per_point).toBeDefined();
    expect(preset.author).toBe('Stims AI Preset Synthesizer');
  });

  it('handles custom color palettes and intensity multipliers', () => {
    const preset = synthesizeEELPreset({
      prompt: 'dark cyberpunk neon matrix grid',
      colorPalette: 'cyberpunk',
      intensity: 1.8,
    });

    expect(preset.wave_r).toBeGreaterThan(0.8);
    expect(preset.warp).toBeGreaterThan(0.1);
  });
});
