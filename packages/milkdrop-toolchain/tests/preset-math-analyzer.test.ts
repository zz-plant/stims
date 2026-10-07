import { describe, expect, it } from 'bun:test';
import { analyzePresetMath } from '../src/preset-math-analyzer.ts';

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
    expect(analysis.colors.primaryHueHint).toBe('Magenta');
    expect(analysis.summary).toContain('Audio: reacts to bass.');
  });

  it('reads the numbered equation lines real .milk files use', () => {
    const analysis = analyzePresetMath(
      'per_frame_1=rot = 0.1 * treb;\nper_pixel_1=zoom = zoom + 0.01 * bass;',
    );
    expect(analysis.motion.hasRotation).toBe(true);
    expect(analysis.audioReactivity.reactsToBass).toBe(true);
    expect(analysis.audioReactivity.reactsToTreble).toBe(true);
  });
});
