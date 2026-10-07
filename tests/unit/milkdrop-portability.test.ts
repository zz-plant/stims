import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import { EditorPanel } from '../../src/js/milkdrop/overlay/editor-panel.ts';
import { checkPortability } from '../../src/js/milkdrop/portability.ts';

/**
 * "Beyond Stims": what in a preset MilkDrop 2 cannot run or reads differently.
 * Stims accepts more than MilkDrop 2 does, so a preset can work here and
 * break everywhere else without the author ever being told.
 */
const check = (source: string) => {
  const compiled = compileMilkdropPresetSource(source, {
    id: `port-${source.length}`,
  });
  return checkPortability(compiled, source);
};
const titles = (source: string) => check(source).map((item) => item.title);

describe('portability checks', () => {
  test('a plain MilkDrop 2 preset has nothing to report', () => {
    expect(
      check(
        [
          'title=Plain',
          'per_frame_1=zoom = 1 + 0.1*sin(time)*bass_att;',
          'per_frame_2=rot = rot + 0.01*above(bass, 1.2);',
          'per_pixel_1=warp = warp + sqr(rad)*0.1;',
          '',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  test('Stims-only functions are named with a MilkDrop 2 rewrite and a line', () => {
    const source = [
      'title=Ext',
      'per_frame_1=zoom = 1.01;',
      'per_frame_2=q1 = clamp(bass, 0, 1); q2 = mod(frame, 4);',
      '',
    ].join('\n');
    const items = check(source);
    const clamp = items.find((item) => item.title.includes('clamp'));
    expect(clamp?.severity).toBe('breaks');
    expect(clamp?.detail).toContain('min(max(x, lo), hi)');
    expect(clamp?.line).toBe(3);
    expect(items.some((item) => item.title.includes('mod()'))).toBe(true);
  });

  test('the line points at the equation, not a shader line using the same name', () => {
    const source = [
      '[comp_shader]',
      'shader_body {',
      '  ret = clamp(tex2D(sampler_main, uv).xyz, 0, 1);',
      '}',
      '[preset00]',
      'per_frame_1=q1 = clamp(bass, 0, 1);',
      '',
    ].join('\n');
    const clamp = check(source).find((item) => item.title.includes('clamp()'));
    expect(clamp?.line).toBe(6);
  });

  test('a Stims signal read but never set differs; one the preset sets itself does not', () => {
    expect(
      titles('title=S\nper_frame_1=zoom = 1 + beat_pulse*0.1;\n'),
    ).toContain('`beat_pulse` only exists in Stims');
    expect(
      titles(
        'title=S\nper_frame_1=vol = (bass+mid+treb)/3;\nper_frame_2=zoom = 1 + vol*0.1;\n',
      ),
    ).toEqual([]);
  });

  test('Stims settings are flagged only when they change something', () => {
    expect(titles('title=M\nmesh_density=48\nzoom=1.01\n')).toEqual([
      '`mesh_density` is a Stims setting',
    ]);
    expect(titles('title=M\nzoom=1.01\n')).toEqual([]);
  });

  test('textures MilkDrop 2 does not ship are listed; its own are not', () => {
    const source = [
      'title=T',
      '[comp_shader]',
      'sampler sampler_clouds2;',
      'shader_body {',
      '  ret = tex2D(sampler_clouds2, uv).xyz + tex2D(sampler_fw_noise_lq, uv).xyz;',
      '  ret += tex2D(sampler_rand01, uv).xyz + tex2D(sampler_blur1, uv).xyz;',
      '}',
      '',
    ].join('\n');
    expect(titles(source)).toEqual(['Needs the texture `clouds2`']);
  });

  test('GLSL in a shader is reported with its HLSL spelling', () => {
    const source = [
      'title=G',
      '[comp_shader]',
      'shader_body {',
      '  vec3 c = tex2D(sampler_main, uv).xyz;',
      '  ret = c;',
      '}',
      '',
    ].join('\n');
    const glsl = check(source).find((item) => item.title.includes('vec3'));
    expect(glsl?.severity).toBe('breaks');
    expect(glsl?.detail).toContain('float2/float3/float4');
    expect(glsl?.line).toBe(4);
  });
});

describe('Compat tab: Beyond Stims', () => {
  let OriginalMutationObserver: typeof globalThis.MutationObserver;
  beforeAll(() => {
    OriginalMutationObserver = globalThis.MutationObserver;
    globalThis.MutationObserver = class {
      disconnect() {}
      observe() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof MutationObserver;
  });
  afterAll(() => {
    globalThis.MutationObserver = OriginalMutationObserver;
  });

  const mount = (source: string) => {
    const panel = new EditorPanel({
      onEditorSourceChange: mock(() => {}),
      onDuplicatePreset: mock(() => {}),
      onExport: mock(() => {}),
      onDeletePreset: mock(() => {}),
      onRequestImport: mock(() => {}),
      onCopyShareLink: mock(() => {}),
    });
    document.body.appendChild(panel.element);
    const compiled = compileMilkdropPresetSource(source, {
      id: `compat-${source.length}`,
    });
    panel.setSessionState({
      source,
      diagnostics: [],
      latestCompiled: compiled,
      activeCompiled: compiled,
      dirty: false,
    });
    return panel;
  };
  const rows = (panel: EditorPanel) =>
    Array.from(
      panel.element.querySelectorAll<HTMLElement>(
        '[data-scope="portability"] .stims-editor__compat-row',
      ),
    );

  test('lists what will not carry over, and says when nothing will stop it', () => {
    const extended = mount(
      'title=E\nper_frame_1=q1 = smoothstep(0, 1, bass);\n',
    );
    expect(rows(extended).map((row) => row.dataset.severity)).toEqual([
      'breaks',
    ]);
    expect(extended.element.textContent).toContain(
      'Will not run as-is in MilkDrop 2.',
    );
    extended.dispose();

    const plain = mount('title=P\nper_frame_1=zoom = 1 + 0.1*bass;\n');
    expect(rows(plain)).toHaveLength(0);
    expect(plain.element.textContent).toContain(
      'Nothing here stops this preset from running in MilkDrop 2.',
    );
    plain.dispose();
  });
});
