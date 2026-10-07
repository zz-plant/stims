import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import {
  findPresetKnobs,
  formatKnobValue,
  knobRange,
  setKnobValue,
} from '../../src/js/milkdrop/preset-knobs.ts';

const names = (source: string) => findPresetKnobs(source).map((k) => k.name);

describe('preset knobs', () => {
  test('a literal set once in init and only read afterwards is a knob', () => {
    const source = [
      'title=T',
      'per_frame_init_1=speed = 1.5; size=0.25;',
      'per_frame_1=rot = rot + speed*0.01;',
      'per_pixel_1=zoom = zoom + size*rad;',
    ].join('\n');
    expect(findPresetKnobs(source)).toMatchObject([
      { name: 'speed', value: 1.5, line: 2, min: 0, max: 3 },
      { name: 'size', value: 0.25, line: 2 },
    ]);
  });

  test('anything assigned outside init is state, not a knob', () => {
    const source = [
      'per_frame_init_1=beat = 0; vol = 0; gain = 2; acc = 1;',
      'per_frame_1=beat = above(bass, 1.2);',
      'per_frame_2=vol = vol*0.9 + bass*0.1;',
      'per_frame_3=acc += 0.1;',
      'wave_0_per_point1=gain = gain;',
    ].join('\n');
    expect(names(source)).toEqual([]);
  });

  test('built-in fields and their aliases are not knobs', () => {
    const source = [
      'per_frame_init_1=zoom = 1.1; decay = 0.9; mv_x = 12; bass = 1; rad = 2; mine = 3;',
      'per_frame_1=rot = mine*0.01;',
      'per_pixel_1=zoom = zoom + rad*0.01;',
    ].join('\n');
    expect(names(source)).toEqual(['mine']);
  });

  test('a value computed or reassigned within init is not a constant', () => {
    const source = 'per_frame_init_1=a = 1; a = a + 1; b = 2*3; c = rand(10);';
    expect(names(source)).toEqual([]);
  });

  test('== comparisons and comments do not count as assignments', () => {
    const source = [
      'per_frame_init_1=k = 4; // k = 99 in the old version',
      'per_frame_1=q1 = if(equal(k, 4), 1, 0) + (k == 4);',
    ].join('\n');
    expect(names(source)).toEqual(['k']);
  });

  test('shader text is never scanned for programs', () => {
    const source = [
      'per_frame_init_1=k = 4;',
      '[comp_shader]',
      'per_frame_1=k = 5;',
    ].join('\n');
    expect(names(source)).toEqual(['k']);
  });

  test('setting a knob rewrites only its literal and the preset still compiles', () => {
    const source =
      'title=T\nper_frame_init_1=speed = 1.5; size=0.25; // tune me\nper_frame_1=rot = speed*0.01*size;\n';
    const [speed, size] = findPresetKnobs(source);
    if (!speed || !size) throw new Error('expected two knobs');
    const once = setKnobValue(source, speed, 2.75);
    expect(once).toBe(
      'title=T\nper_frame_init_1=speed = 2.75; size=0.25; // tune me\nper_frame_1=rot = speed*0.01*size;\n',
    );
    // Offsets from the original still find size's literal after the edit
    // re-scans the source.
    const rescanned = findPresetKnobs(once)[1];
    if (!rescanned) throw new Error('size knob lost after the first edit');
    const twice = setKnobValue(once, rescanned, 0.5);
    expect(twice).toContain('size=0.5;');
    expect(size.name).toBe('size');
    expect(
      compileMilkdropPresetSource(twice, {
        id: 'knob-compile',
      }).diagnostics.filter((d) => d.severity === 'error'),
    ).toEqual([]);
  });

  test('ranges are centred on the value, at its own scale', () => {
    expect(knobRange(0)).toEqual({ min: -1, max: 1 });
    expect(knobRange(0.01)).toEqual({ min: 0, max: 0.02 });
    expect(knobRange(0.3)).toEqual({ min: 0, max: 0.6 });
    expect(knobRange(128)).toEqual({ min: 0, max: 256 });
    expect(knobRange(-2)).toEqual({ min: -4, max: 0 });
  });

  test('values are written with four significant digits', () => {
    expect(formatKnobValue(0.012345)).toBe('0.01235');
    expect(formatKnobValue(127.6)).toBe('127.6');
    expect(formatKnobValue(0)).toBe('0');
  });

  test('a variable that is set but never read is not a knob', () => {
    const source =
      'per_frame_init_1=unused = 3; used = 2;\nper_frame_1=rot = used*0.1;';
    expect(names(source)).toEqual(['used']);
  });

  test('a q-var read only by a shader or a wave still counts', () => {
    const shader =
      'per_frame_init_1=q5 = 0.7;\n[comp_shader]\nshader_body { ret = ret * q5; }';
    expect(names(shader)).toEqual(['q5']);
    const backtick = 'per_frame_init_1=q6 = 0.2;\ncomp_1=`ret = ret * q6;';
    expect(names(backtick)).toEqual(['q6']);
    const wave = 'per_frame_init_1=q7 = 0.3;\nwave_0_per_point1=y = y + q7;';
    expect(names(wave)).toEqual(['q7']);
  });
});

describe('preset knobs on older drafts', () => {
  test('init_N lines (the older Stims spelling) are init too', () => {
    const source = 'init_1=speed = 2;\nper_frame_1=rot = speed*0.01;';
    expect(findPresetKnobs(source).map((k) => k.name)).toEqual(['speed']);
  });
});
