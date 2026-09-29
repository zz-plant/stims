import { describe, expect, test } from 'bun:test';
import { buildCompatChecklist } from '../../src/js/milkdrop/compat-checklist.ts';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';

const build = (source: string) =>
  buildCompatChecklist(
    compileMilkdropPresetSource(source, { id: 'compat-probe' }),
    source,
  );

const PROBLEM_PRESET = [
  'title=T',
  'zoom=1.01',
  'bogus_field=3',
  'per_frame_1=q1 = notafunction(bass);',
  'per_frame_2=zoom = zoom + 0.01*sin(time);',
].join('\n');

describe('compat checklist', () => {
  test('a clean preset has no items and a plain headline', () => {
    const checklist = build(
      'title=T\nzoom=1.01\nper_frame_1=rot = rot + 0.01;\n',
    );
    expect(checklist.items).toEqual([]);
    expect(checklist.fidelity).toBe('exact');
    expect(checklist.headline).toContain('exactly');
  });

  test('an unknown function is a blocker pointing at the line that uses it', () => {
    const item = build(PROBLEM_PRESET).items.find((i) =>
      i.title.includes('notafunction'),
    );
    expect(item?.severity).toBe('blocker');
    expect(item?.line).toBe(4);
    expect(item?.detail).toContain('0 at runtime');
  });

  test('an ignored field points at its own line', () => {
    const item = build(PROBLEM_PRESET).items.find((i) =>
      i.title.includes('bogus_field'),
    );
    expect(item?.severity).toBe('ignored');
    expect(item?.line).toBe(3);
  });

  test('worst problems sort first, and nothing is listed twice', () => {
    const items = build(PROBLEM_PRESET).items;
    const order = items.map((i) => i.severity);
    expect(order.indexOf('blocker')).toBeLessThan(order.indexOf('ignored'));
    const titles = items.map((i) => i.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  test('a mention in a comment is not where the function is used', () => {
    const source = [
      'title=T',
      '// notafunction is discussed here but not called',
      'per_frame_1=q1 = notafunction(bass);',
    ].join('\n');
    const item = build(source).items.find((i) =>
      i.title.includes('notafunction'),
    );
    expect(item?.line).toBe(3);
  });

  test('reports the status of both renderers', () => {
    const engines = build(PROBLEM_PRESET).engines;
    expect(engines.map((e) => e.engine)).toEqual(['WebGL', 'WebGPU']);
  });

  test('an approximated shader line maps back to the buffer, in either syntax', () => {
    const source = [
      'title=T',
      'comp_1=`shader_body',
      'comp_2=`{',
      'comp_3=`  ret = tex2D(sampler_main, uv).xyz * 2.0;',
      'comp_4=`}',
    ].join('\n');
    const compiled = compileMilkdropPresetSource(source, {
      id: 'compat-approx',
    });
    compiled.ir.compatibility.parity.approximatedShaderLines = [
      'ret = tex2D(sampler_main, uv).xyz * 2.0;',
    ];
    const item = buildCompatChecklist(compiled, source).items.find(
      (i) => i.severity === 'approximation',
    );
    expect(item?.line).toBe(4);

    const sectionSource = [
      'title=T',
      '[comp_shader]',
      'shader_body {',
      '  ret = tex2D(sampler_main, uv).xyz * 2.0;',
      '}',
    ].join('\n');
    const compiled2 = compileMilkdropPresetSource(sectionSource, {
      id: 'compat-approx2',
    });
    compiled2.ir.compatibility.parity.approximatedShaderLines = [
      'ret = tex2D(sampler_main, uv).xyz * 2.0;',
    ];
    expect(buildCompatChecklist(compiled2, sectionSource).items[0]?.line).toBe(
      4,
    );
  });
});
