/**
 * The dataflow analysis against small presets whose dependencies are known,
 * one VM rule per test: built-ins reset every frame, persistent variables
 * accumulate, conditional writes depend on their condition, init is silent,
 * and one audio-gated rand() makes the whole random stream follow the audio.
 */
import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import {
  analyzePresetDataflow,
  controlAudio,
  dataflowSignature,
} from '../../src/js/milkdrop/preset-dataflow.ts';

let serial = 0;
function compile(lines: string[]) {
  const source = `[preset00]\n${lines.join('\n')}\n`;
  return compileMilkdropPresetSource(source, {
    id: `dataflow-${serial++}`,
  });
}
function analyze(lines: string[]) {
  const result = analyzePresetDataflow(compile(lines).ir);
  return {
    ...result,
    variable: (name: string) => result.variables.get(name),
  };
}

describe('analyzePresetDataflow', () => {
  test('a control driven by an audio signal is audio', () => {
    const { variable } = analyze(['per_frame_1=zoom = 1 + bass*0.1;']);
    expect(variable('zoom')).toMatchObject({
      kind: 'audio',
      audio: ['bass'],
      accumulates: false,
    });
  });

  test('a control driven only by the clock is clockwork', () => {
    const { variable } = analyze(['per_frame_1=rot = 0.1*sin(time);']);
    expect(variable('rot')).toMatchObject({
      kind: 'clockwork',
      audio: [],
      clock: ['time'],
    });
  });

  test('a built-in read before it is written reads its constant base', () => {
    // zoom is restored to its base before every frame, so this cannot build up
    const { variable } = analyze(['per_frame_1=zoom = zoom*1.01;']);
    expect(variable('zoom')).toMatchObject({
      kind: 'constant',
      accumulates: false,
    });
  });

  test('a persistent register that reads itself accumulates, and passes that on', () => {
    const { variable } = analyze([
      'per_frame_1=q1 = q1*0.9 + bass_att;',
      'per_frame_2=zoom = 1 + q1*0.01;',
    ]);
    expect(variable('q1')).toMatchObject({
      kind: 'audio',
      audio: ['bass_att'],
      accumulates: true,
    });
    expect(variable('zoom')).toMatchObject({
      kind: 'audio',
      audio: ['bass_att'],
      accumulates: false,
    });
  });

  test('memory through another variable is found by the fixpoint', () => {
    // a reads last frame's b; b = a + treb therefore feeds back on itself
    const { variable } = analyze([
      'per_frame_1=a = b*0.5;',
      'per_frame_2=b = a + treb;',
    ]);
    expect(variable('b')).toMatchObject({
      audio: ['treb'],
      accumulates: true,
      history: true,
    });
    // a carries b's audio history without feeding back on itself
    expect(variable('a')).toMatchObject({
      audio: ['treb'],
      accumulates: false,
      history: true,
    });
  });

  test('a value computed from this frame alone has no history', () => {
    const { variable } = analyze(['per_frame_1=wave_r = 0.5 + 0.5*treb;']);
    expect(variable('wave_r')).toMatchObject({
      audio: ['treb'],
      history: false,
    });
  });

  test('a write that only sometimes runs depends on its condition', () => {
    const { variable } = analyze([
      'per_frame_1=if(above(mid, 1.2), q3 = 0.5, 0);',
    ]);
    expect(variable('q3')).toMatchObject({
      kind: 'audio',
      audio: ['mid'],
      accumulates: true,
    });
  });

  test('what init sets is constant: it runs once with silent audio', () => {
    const { variable } = analyze([
      'per_frame_init_1=q5 = bass;',
      'per_frame_1=q6 = q5*2;',
    ]);
    expect(variable('q6')).toMatchObject({ kind: 'constant', audio: [] });
  });

  test('rand() is clockwork: the stream is seeded per preset', () => {
    const { variable, randomStreamFollowsAudio } = analyze([
      'per_frame_1=q4 = rand(10);',
    ]);
    expect(randomStreamFollowsAudio).toBe(false);
    expect(variable('q4')).toMatchObject({ kind: 'clockwork', random: true });
  });

  test('one audio-gated rand() makes every rand() follow the audio', () => {
    const { variable, randomStreamFollowsAudio } = analyze([
      'per_frame_1=q4 = rand(10);',
      'per_frame_2=q8 = if(above(bass, 1), rand(2), 0);',
    ]);
    expect(randomStreamFollowsAudio).toBe(true);
    expect(variable('q4')).toMatchObject({
      kind: 'audio',
      audio: ['bass'],
      random: true,
    });
  });

  test('values stored in megabuf carry their sources back out', () => {
    const { variable } = analyze([
      'per_frame_1=megabuf(0) = vol;',
      'per_frame_2=q7 = megabuf(0);',
    ]);
    expect(variable('q7')).toMatchObject({
      kind: 'audio',
      audio: ['vol'],
      memory: true,
    });
  });

  test('a custom wave that stores waveform samples in gmegabuf feeds per-frame code', () => {
    const { variable } = analyze([
      'wavecode_0_enabled=1',
      'wave_0_per_point1=gmegabuf(0) = value1;',
      'per_frame_1=q9 = gmegabuf(0);',
    ]);
    expect(variable('q9')).toMatchObject({
      kind: 'audio',
      audio: ['value1'],
      memory: true,
    });
  });

  test("a shape's write to a q register reaches next frame's per-frame code", () => {
    const { variable } = analyze([
      'shapecode_0_enabled=1',
      'shape_0_per_frame1=q10 = bass;',
      'per_frame_1=zoom = 1 + q10*0.01;',
    ]);
    expect(variable('zoom')).toMatchObject({
      kind: 'audio',
      audio: ['bass'],
      history: true,
    });
  });

  test('a write under one spelling reaches a read under its alias', () => {
    // the compiler stores mv_x as motion_vectors_x; the read keeps mv_x
    const { variable } = analyze([
      'per_frame_1=mv_x = 30*bass;',
      'per_frame_2=mv_dx = 0.01*mv_x;',
    ]);
    expect(variable('mv_dx')).toMatchObject({ kind: 'audio', audio: ['bass'] });
  });

  test('a register written by per-pixel code ends the frame holding that value', () => {
    // per-frame leaves q2 constant; the per-pixel pass then overwrites it from treb
    const { variable } = analyze([
      'per_frame_1=q2 = 0;',
      'per_pixel_1=q2 = treb*x;',
    ]);
    expect(variable('q2')).toMatchObject({ kind: 'audio', audio: ['treb'] });
  });

  test('a self-incrementing counter is an implicit clock', () => {
    const { variable } = analyze([
      'per_frame_1=counter = counter + 1;',
      'per_frame_2=ob_r = 0.5*sin(counter*0.1);',
    ]);
    expect(variable('ob_r')).toMatchObject({
      kind: 'clockwork',
      clock: ['accumulator'],
      audio: [],
    });
  });

  test('per-pixel rad is fixed by the grid, whatever moves the centre', () => {
    const { variable } = analyze([
      'per_frame_1=cx = 0.5 + 0.1*mid; rad = bass;',
      'per_pixel_1=q1 = 0.8*(0.7 - rad);',
    ]);
    expect(variable('q1')).toMatchObject({ kind: 'constant', audio: [] });
  });
  test('audio reaching the per-pixel mesh is reported for that program', () => {
    const { drawnAudio } = analyze([
      'per_frame_1=q1 = mid;',
      'per_pixel_1=zoom = zoom + 0.01*treb_att*rad;',
      'per_pixel_2=rot = rot + 0.01*q1;',
    ]);
    expect(drawnAudio.perPixel).toEqual(['mid', 'treb_att']);
  });

  test('a per-pixel write overwritten without being read carries nothing', () => {
    const { drawnAudio } = analyze([
      'per_pixel_1=rot = rot + 0.005*cos(ang*bass);',
      'per_pixel_2=rot = 0.1*sin(ang);',
    ]);
    expect(drawnAudio.perPixel).toEqual([]);
  });

  test('a temporary that nothing draws carries nothing', () => {
    const { drawnAudio } = analyze([
      'per_pixel_1=unused = bass;',
      'shapecode_0_enabled=1',
      'shape_0_per_frame1=wobble = treb;',
    ]);
    expect(drawnAudio.perPixel).toEqual([]);
    expect(drawnAudio.shapes[0]).toEqual([]);
  });

  test('only enabled custom waves and shapes are drawn', () => {
    const { drawnAudio } = analyze([
      'wavecode_0_enabled=1',
      'wave_0_per_frame1=t1 = bass;',
      'wave_0_per_point1=y = t1 + value1*0.1;',
      'wavecode_1_enabled=0',
      'wave_1_per_frame1=t1 = treb;',
      'shapecode_0_enabled=1',
      'shape_0_per_frame1=rad = 0.1 + 0.1*mid;',
    ]);
    expect(drawnAudio.waves[0]).toEqual(['bass', 'value1']);
    expect(drawnAudio.waves[1]).toEqual([]);
    expect(drawnAudio.shapes[0]).toEqual(['mid']);
  });

  test('a warp control follows what the per-pixel program leaves in it', () => {
    // per-frame zoom follows bass; per-pixel code replaces it outright...
    const replaced = analyze([
      'per_frame_1=zoom = 1 + 0.1*bass;',
      'per_pixel_1=zoom = 1 + 0.1*treb*rad;',
    ]);
    expect(controlAudio(replaced, 'zoom')).toEqual(['treb']);
    // ...or builds on it, so both reach the mesh
    const built = analyze([
      'per_frame_1=zoom = 1 + 0.1*bass;',
      'per_pixel_1=zoom = zoom + 0.1*treb*rad;',
    ]);
    expect(controlAudio(built, 'zoom')).toEqual(['bass', 'treb']);
  });

  test('a control no program writes has no answer', () => {
    const result = analyze(['per_frame_1=zoom = 1 + 0.1*bass;']);
    expect(controlAudio(result, 'zoom')).toEqual(['bass']);
    expect(controlAudio(result, 'rot')).toBeNull();
  });

  test('the signature ignores literals and follows the equations', () => {
    const signature = (lines: string[]) => dataflowSignature(compile(lines).ir);
    const base = signature(['zoom=1.0', 'per_frame_1=zoom = 1 + 0.1*bass;']);
    expect(signature(['zoom=1.5', 'per_frame_1=zoom = 1 + 0.1*bass;'])).toBe(
      base,
    );
    expect(
      signature(['zoom=1.0', 'per_frame_1=zoom = 1 + 0.1*treb;']),
    ).not.toBe(base);
    expect(
      signature([
        'zoom=1.0',
        'per_frame_1=zoom = 1 + 0.1*bass;',
        'per_pixel_1=rot = 0.1*mid;',
      ]),
    ).not.toBe(base);
    // only an enabled wave is drawn, so switching one on changes the answer
    const wave = (enabled: number) =>
      signature([
        `wavecode_0_enabled=${enabled}`,
        'wave_0_per_frame1=r = bass;',
      ]);
    expect(wave(1)).not.toBe(wave(0));
  });
});
