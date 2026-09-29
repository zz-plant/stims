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
      onRevertToActive: mock(() => {}),
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
});
