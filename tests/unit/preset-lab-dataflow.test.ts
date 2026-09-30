/**
 * The preset audio labels lab:dataflow --all writes: how audio reaches what
 * a preset draws, from the equations and shader text alone.
 */
import { describe, expect, test } from 'bun:test';
import { labelPresetAudio } from '../../scripts/preset-lab-dataflow.ts';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';

let serial = 0;
function label(lines: string[]) {
  const source = `[preset00]\n${lines.join('\n')}\n`;
  return labelPresetAudio(
    compileMilkdropPresetSource(source, { id: `label-${serial++}` }).ir,
  );
}

describe('labelPresetAudio', () => {
  test('an equation that moves the picture with the audio makes it driven', () => {
    const result = label(['per_frame_1=zoom = 1 + 0.1*bass;']);
    expect(result.tier).toBe('driven');
    expect(result.audioColumns).toEqual({ zoom: ['bass'] });
    expect(result.historyColumns).toEqual([]);
  });

  test('an audio column fed by an accumulator is marked as carrying history', () => {
    const result = label([
      'per_frame_1=q1 = 0.9*q1 + 0.1*bass;',
      'per_frame_2=q2 = treb;',
    ]);
    expect(result.historyColumns).toEqual(['q1']);
  });

  test('a shader reading an audio uniform makes it driven', () => {
    const result = label([
      'wave_a=0',
      'comp_1=`shader_body',
      'comp_2=`{',
      'comp_3=`ret = tex2D(sampler_main, uv).xyz * (1 + bass_att);',
      'comp_4=`}',
    ]);
    expect(result.tier).toBe('driven');
    expect(result.shaderSignals).toEqual(['bass_att']);
  });

  test('a custom wave drawing only its samples is waveform-only', () => {
    const result = label([
      'wave_a=0',
      'wavecode_0_enabled=1',
      'wave_0_per_point1=y = 0.5 + value1*0.2;',
    ]);
    expect(result.tier).toBe('waveform-only');
    expect(result.waveSignals).toEqual([]);
  });

  test('the visible main waveform alone is waveform-only', () => {
    const result = label(['wave_a=0.8', 'per_frame_1=rot = 0.01*sin(time);']);
    expect(result.tier).toBe('waveform-only');
    expect(result.clockworkColumns).toContain('rot');
  });

  test('audio mentioned only in overwritten code reaches nothing', () => {
    const result = label([
      'wave_a=0',
      'per_frame_1=q1 = bass;',
      'per_frame_2=q1 = 0.4*time;',
    ]);
    expect(result.tier).toBe('none');
  });
});
