import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import { EditorPanel } from '../../src/js/milkdrop/overlay/editor-panel.ts';
import {
  clearRenderIsolation,
  getRenderIsolation,
} from '../../src/js/milkdrop/render-isolation.ts';

describe('editor panel Outline tab', () => {
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

  const SOURCE = [
    'title=T',
    'zoom=1.01',
    'per_frame_1=zoom = zoom + 0.01;',
    'per_frame_2=rot = rot + 0.01;',
    'per_pixel_1=rot = rot + rad;',
  ].join('\n');

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
    panel.setSessionState({
      source,
      diagnostics: [],
      latestCompiled: null,
      activeCompiled: null,
      dirty: false,
    });
    return panel;
  };
  const rows = (panel: EditorPanel) =>
    Array.from(
      panel.element.querySelectorAll<HTMLElement>('.stims-editor__outline-row'),
    );
  /** The audio tag's text on the first row whose label starts with
   * `label`, or null with no tag. Text, not the element: a failing matcher
   * that has to print a DOM node aborts the test runner. */
  const audioTagFor = (panel: EditorPanel, label: string) =>
    rows(panel)
      .find((row) => row.querySelector('code')?.textContent?.startsWith(label))
      ?.querySelector<HTMLElement>('.stims-editor__outline-audio')
      ?.textContent ?? null;
  const cursorLine = (panel: EditorPanel) => {
    const view = (
      panel as unknown as {
        editor: {
          state: {
            selection: { main: { from: number } };
            doc: { lineAt: (pos: number) => { number: number } };
          };
        };
      }
    ).editor;
    return view.state.doc.lineAt(view.state.selection.main.from).number;
  };

  test('lists the parts of the preset in buffer order with their ranges', () => {
    const panel = mount(SOURCE);
    expect(rows(panel).map((row) => row.textContent)).toEqual([
      'Settingslines 1–2',
      'Per-frame equationslines 3–4',
      'Per-pixel equationsline 5',
    ]);
    panel.dispose();
  });

  test('clicking a part moves the cursor to its first line', () => {
    const panel = mount(SOURCE);
    rows(panel)
      .find((row) => row.dataset.kind === 'per-pixel')
      ?.click();
    expect(cursorLine(panel)).toBe(5);
    panel.dispose();
  });

  test('follows the source when the preset changes', () => {
    const panel = mount(SOURCE);
    panel.setSessionState({
      source: 'per_pixel_1=a=1;\n',
      diagnostics: [],
      latestCompiled: null,
      activeCompiled: null,
      dirty: true,
    });
    expect(rows(panel).map((row) => row.dataset.kind)).toEqual(['per-pixel']);
    panel.dispose();
  });

  test('Tune stays the default tab', () => {
    const panel = mount(SOURCE);
    const selected = panel.element.querySelector(
      '[role="tab"][aria-selected="true"]',
    );
    expect((selected as HTMLElement | null)?.dataset.pane).toBe('tune');
    panel.dispose();
  });

  test('a shader part can show the GLSL it becomes, and stays open while you type', () => {
    const shaderSource = [
      'title=T',
      'zoom=1.01',
      '[warp_shader]',
      'shader_body {',
      '  ret = tex2D(sampler_main, uv).xyz * 0.97;',
      '}',
    ].join('\n');
    const panel = mount(shaderSource);
    const setCompiled = (source: string) => {
      const compiled = compileMilkdropPresetSource(source, {
        id: 'outline-shader',
      });
      panel.setSessionState({
        source,
        diagnostics: [],
        latestCompiled: compiled,
        activeCompiled: compiled,
        dirty: false,
      });
    };
    setCompiled(shaderSource);

    const toggle = () =>
      panel.element.querySelector<HTMLButtonElement>(
        '[data-shader-stage="warp"] .stims-editor__outline-glsl',
      );
    const detail = () =>
      panel.element.querySelector<HTMLElement>(
        '[data-shader-stage="warp"] .stims-editor__shader-translation',
      );
    expect(detail()?.hidden).toBe(true);
    toggle()?.click();
    expect(detail()?.hidden).toBe(false);
    expect(detail()?.textContent).toContain('WebGL runs it as written');
    expect(detail()?.querySelector('pre')?.textContent).not.toContain('tex2D(');

    // A repaint (the next keystroke's compile) keeps it open.
    setCompiled(`${shaderSource}\n`);
    expect(detail()?.hidden).toBe(false);
    panel.dispose();
  });

  test('parts that are not shaders get no GLSL toggle', () => {
    const panel = mount(SOURCE);
    expect(
      panel.element.querySelector('.stims-editor__outline-glsl'),
    ).toBeNull();
    panel.dispose();
  });

  test('wave and shape rows can be soloed and muted, once per slot', () => {
    const source = [
      'title=Isolate',
      'wavecode_0_enabled=1',
      'wave_0_per_frame1=r = 1;',
      'shapecode_1_enabled=1',
      '',
    ].join('\n');
    const panel = mount(source);
    const compiled = compileMilkdropPresetSource(source, {
      id: 'outline-isolate',
    });
    panel.setSessionState({
      source,
      diagnostics: [],
      latestCompiled: compiled,
      activeCompiled: compiled,
      dirty: false,
    });
    const toggle = (action: string, kind: string, index: number) =>
      panel.element.querySelectorAll<HTMLButtonElement>(
        `[data-isolate="${action}"][data-isolate-kind="${kind}"][data-isolate-index="${index}"]`,
      );
    // wave_0 has a settings row and a code row; it still gets one pair.
    expect(toggle('solo', 'wave', 1)).toHaveLength(1);
    expect(toggle('mute', 'shape', 2)).toHaveLength(1);

    toggle('solo', 'wave', 1)[0]?.click();
    expect(getRenderIsolation()?.solo).toEqual({ kind: 'wave', index: 1 });
    expect(toggle('solo', 'wave', 1)[0]?.getAttribute('aria-pressed')).toBe(
      'true',
    );

    toggle('mute', 'shape', 2)[0]?.click();
    expect(getRenderIsolation()?.muted).toEqual([{ kind: 'shape', index: 2 }]);
    expect(toggle('mute', 'shape', 2)[0]?.getAttribute('aria-pressed')).toBe(
      'true',
    );

    toggle('solo', 'wave', 1)[0]?.click();
    expect(getRenderIsolation()?.solo ?? null).toBeNull();
    expect(toggle('solo', 'wave', 1)[0]?.getAttribute('aria-pressed')).toBe(
      'false',
    );
    clearRenderIsolation();
    panel.dispose();
  });
  test('the layers a preset draws get Solo and Mute, under Settings', () => {
    const source = [
      'title=Layers',
      'wave_a=0.8',
      'ob_size=0.02',
      'ob_a=0.5',
      // motion vectors stay off: the toggle is off and mv_a is 0
      'mv_a=0',
      'per_frame_1=zoom = 1.01;',
    ].join('\n');
    const panel = mount(source);
    const compiled = compileMilkdropPresetSource(source, {
      id: 'outline-layers',
    });
    panel.setSessionState({
      source,
      diagnostics: [],
      latestCompiled: compiled,
      activeCompiled: compiled,
      dirty: false,
    });
    const layers = () =>
      Array.from(
        panel.element.querySelectorAll<HTMLElement>(
          '.stims-editor__outline-layer',
        ),
        (row) => row.dataset.kind,
      );
    expect(layers()).toEqual(['main-wave', 'borders']);
    // Right after the Settings row, where their fields live.
    const list = panel.element.querySelector('.stims-editor__outline');
    const items = Array.from(list?.children ?? []);
    const settings = items.findIndex(
      (item) =>
        item.querySelector('code')?.textContent === 'Settings' ||
        (item as HTMLElement).dataset.kind === 'settings',
    );
    expect(
      items[settings + 1]?.querySelector<HTMLElement>(
        '.stims-editor__outline-layer',
      )?.dataset.kind,
    ).toBe('main-wave');

    const mute = panel.element.querySelector<HTMLButtonElement>(
      '[aria-label="Mute borders"]',
    );
    mute?.click();
    expect(getRenderIsolation()?.muted).toEqual([
      { kind: 'borders', index: 0 },
    ]);
    expect(mute?.getAttribute('aria-pressed')).toBe('true');

    // An equation that writes an alpha the file leaves at 0 draws the layer.
    const driven = `${source}\nper_frame_2=mv_a = 0.5*bass;`;
    panel.setSessionState({
      source: driven,
      diagnostics: [],
      latestCompiled: compileMilkdropPresetSource(driven, {
        id: 'outline-layers',
      }),
      activeCompiled: compileMilkdropPresetSource(driven, {
        id: 'outline-layers',
      }),
      dirty: false,
    });
    expect(layers()).toEqual(['motion-vectors', 'main-wave', 'borders']);

    clearRenderIsolation();
    panel.dispose();
  });

  test('each drawn part says which audio reaches what it draws', () => {
    const source = [
      'per_frame_1=q1 = mid_att;',
      'per_pixel_1=zoom = zoom + 0.01*q1*rad;',
      // a wave whose code draws the waveform
      'wavecode_0_enabled=1',
      'wave_0_per_point1=y = 0.5 + value1*0.3;',
      // a wave whose code reads no audio: its points may still sit on the
      // waveform, so the row makes no claim
      'wavecode_2_enabled=1',
      'wave_2_per_point1=x = sample;',
      'shapecode_0_enabled=1',
      'shape_0_per_frame1=rad = 0.1 + 0.2*bass;',
      // slots need not be contiguous: the IR lists only those defined
      'shapecode_3_enabled=1',
      'shape_3_per_frame1=ang = time;',
      // disabled: draws nothing
      'shapecode_2_enabled=0',
      'shape_2_per_frame1=rad = treb;',
    ].join('\n');
    const panel = mount(source);
    const compiled = compileMilkdropPresetSource(source, {
      id: 'outline-audio',
    });
    panel.setSessionState({
      source,
      diagnostics: [],
      latestCompiled: compiled,
      activeCompiled: compiled,
      dirty: false,
    });

    // through q1, which the per-pixel code reads
    expect(audioTagFor(panel, 'Per-pixel')).toBe('mid_att');
    expect(audioTagFor(panel, 'wave_0')).toBe('waveform');
    expect(audioTagFor(panel, 'wave_2')).toBeNull();
    expect(audioTagFor(panel, 'shape_0')).toBe('bass');
    expect(audioTagFor(panel, 'shape_3')).toBe('no audio');
    expect(audioTagFor(panel, 'shape_2')).toBeNull();
    // one tag per part, on its first row
    expect(
      panel.element.querySelectorAll('.stims-editor__outline-audio'),
    ).toHaveLength(4);

    panel.dispose();
  });
});
