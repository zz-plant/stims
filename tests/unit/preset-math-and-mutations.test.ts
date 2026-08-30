import { describe, expect, it } from 'bun:test';
import { analyzePresetMath } from '../../src/js/milkdrop/preset-math-analyzer.ts';
import {
  blendPresetSources,
  mutatePresetStyle,
} from '../../src/js/milkdrop/preset-mutations.ts';

describe('preset math analyzer', () => {
  const samplePreset = `[preset00]
fRating=3.000000
fDecay=0.960000
fWaveAlpha=0.800000
fWaveScale=1.000000
fWaveSmoothing=0.750000
fWaveParam=0.000000
fModWaveAlphaByVolume=0
fModWaveAlphaByFreq=0
fWaveMode=0
fWaveR=0.900000
fWaveG=0.100000
fWaveB=0.800000
fWaveX=0.500000
fWaveY=0.500000
bAdditiveWaves=0
bWaveDots=0
bWaveThick=0
bModWaveAlphaByVolume=0
bMaximizeWaveColor=1
bTexWrap=1
bDarkenCenter=0
bRedBlueStereo=0
bBrighten=0
bDarken=0
bSolarize=0
bInvert=0
fWarpAnimSpeed=1.000000
fWarpScale=1.000000
fZoomExponent=1.000000
fShader=0.000000
zoom=1.030000
rot=0.020000
cx=0.500000
cy=0.500000
dx=0.000000
dy=0.000000
warp=0.120000
sx=1.000000
sy=1.000000
wave_r=0.900000
wave_g=0.100000
wave_b=0.800000
wave_x=0.500000
wave_y=0.500000
per_frame=zoom = 1.0 + 0.05 * sin(time * 0.8) + 0.03 * bass_att;
per_frame=rot = 0.02 * cos(time * 0.5);
per_pixel=rot = rot + 0.04 * sin(rad * 6.0 - time);
per_pixel=warp = warp + 0.05 * sin(ang * 4.0);
`;

  it('analyzes motion vectors and reactivity accurately', () => {
    const analysis = analyzePresetMath(samplePreset);
    expect(analysis.motion.hasZoom).toBe(true);
    expect(analysis.motion.hasRotation).toBe(true);
    expect(analysis.motion.hasWarp).toBe(true);
    expect(analysis.audioReactivity.reactsToBass).toBe(true);
    expect(analysis.colors.primaryHueHint).toContain('Neon synthwave');
    expect(analysis.summary).toContain('preset');
  });
});

describe('preset mutations', () => {
  const base = `[preset00]
zoom=1.000000
rot=0.000000
warp=0.000000
decay=0.980000
wave_r=0.500000
wave_g=0.500000
wave_b=0.500000
`;

  it('mutates style to cyberpunk with neon palette and treble response', () => {
    const mutated = mutatePresetStyle(base, 'cyberpunk');
    expect(mutated).toContain('wave_r=0.95');
    expect(mutated).toContain('wave_b=0.85');
    expect(mutated).toContain('treb_att');
  });

  it('mutates style to hyperspace with vortex zoom and coordinate warp', () => {
    const mutated = mutatePresetStyle(base, 'hyperspace');
    expect(mutated).toContain('zoom=1.04');
    expect(mutated).toContain('rad * 6.0');
  });

  it('blends two presets with linear interpolation', () => {
    const other = `[preset00]
zoom=1.100000
rot=0.100000
warp=0.200000
decay=0.900000
wave_r=1.000000
wave_g=0.000000
wave_b=0.000000
`;
    const blended = blendPresetSources(base, other, 0.5);
    expect(blended).toContain('zoom=1.05');
    expect(blended).toContain('rot=0.05');
    expect(blended).toContain('decay=0.94');
  });
});
