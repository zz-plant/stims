/**
 * The Shader pane — segment outline, compile diagnostics, lowered GLSL.
 *
 * Mounts the real EditorPanel the way the workspace does and drives the
 * real diagnostics plumbing: a broken warp program is assembled with the
 * real feedback-manager assembler and recorded through the installed
 * onShaderError hook with a fake GL answering the way a driver would
 * (the same pattern as milkdrop-shader-compile-diagnostics.test.ts), so
 * the pane is tested against the records the engine actually produces.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import { assembleMilkdropDirectFragmentShaders } from '../../src/js/milkdrop/feedback-manager-shared.ts';
import { EditorPanel } from '../../src/js/milkdrop/overlay/editor-panel.ts';
import {
  clearMilkdropShaderCompileDiagnostics,
  installMilkdropWebglShaderErrorTracking,
  type MilkdropWebglShaderErrorContext,
} from '../../src/js/milkdrop/shader-compile-diagnostics.ts';
import type { MilkdropEditorSessionState } from '../../src/js/milkdrop/types.ts';

const SHADER_SOURCE = [
  'title=Shader pane',
  'zoom=1.01',
  '[warp_shader]',
  'shader_body {',
  '  ret = tex2D(sampler_main, uv).xyz * 0.97;',
  '}',
  '[comp_shader]',
  'shader_body {',
  '  ret = tex2D(sampler_main, uv).xyz;',
  '}',
].join('\n');

const PLAIN_SOURCE = ['title=Plain', 'per_frame_1=zoom = zoom + 0.01;'].join(
  '\n',
);

/** Fires three's onShaderError hook the way a WebGL driver failure
 * would: fragment broken, its info log reported, warp template source. */
function recordBrokenWarpFragment(log: string): void {
  const { warp: fragment } = assembleMilkdropDirectFragmentShaders(
    'ret = this_identifier_does_not_exist;',
    null,
  );
  const COMPILE_STATUS = 35714;
  const gl: MilkdropWebglShaderErrorContext = {
    COMPILE_STATUS,
    getShaderParameter: (shader: unknown) => shader !== 'fragment',
    getShaderInfoLog: (shader: unknown) => (shader === 'fragment' ? log : ''),
    getProgramInfoLog: () => '',
    getShaderSource: (shader: unknown) =>
      shader === 'fragment' ? fragment : '',
  };
  const renderer = { debug: {} } as {
    debug: {
      onShaderError?: (
        gl: MilkdropWebglShaderErrorContext,
        program: unknown,
        vertexShader: unknown,
        fragmentShader: unknown,
      ) => void;
    };
  };
  installMilkdropWebglShaderErrorTracking(renderer);
  renderer.debug.onShaderError?.(gl, 'program', 'vertex', 'fragment');
}

describe('editor panel Shader tab', () => {
  let OriginalMutationObserver: typeof MutationObserver;
  beforeAll(() => {
    clearMilkdropShaderCompileDiagnostics();
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
    clearMilkdropShaderCompileDiagnostics();
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
    panel.setSessionState({
      source,
      diagnostics: [],
      latestCompiled: null,
      activeCompiled: null,
      dirty: false,
    });
    return panel;
  };
  const mountCompiled = (source: string) => {
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
      id: 'shader-pane',
    });
    const state: MilkdropEditorSessionState = {
      source,
      diagnostics: [],
      latestCompiled: compiled,
      activeCompiled: compiled,
      dirty: false,
    };
    panel.setSessionState(state);
    return panel;
  };
  const pane = (panel: EditorPanel) =>
    panel.element.querySelector<HTMLElement>('#stims-editor-pane-shader');
  const segmentRows = (panel: EditorPanel) =>
    Array.from(
      pane(panel)?.querySelectorAll<HTMLElement>('.stims-editor__shader-row') ??
        [],
    );
  const diagnosticRows = (panel: EditorPanel) =>
    Array.from(
      pane(panel)?.querySelectorAll<HTMLElement>(
        '.stims-editor__shader-diag',
      ) ?? [],
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

  test('a shader tab sits in the dock and selects a pane', () => {
    const panel = mount(PLAIN_SOURCE);
    const tab = panel.element.querySelector<HTMLElement>(
      '[role="tab"][data-pane="shader"]',
    );
    expect(tab?.textContent).toBe('Shader');
    tab?.click();
    expect(pane(panel)?.hidden).toBe(false);
    panel.dispose();
  });

  test('each shader segment gets a row that jumps to its header line', () => {
    const panel = mount(SHADER_SOURCE);
    const rows = segmentRows(panel);
    expect(rows.map((row) => row.dataset.stage)).toEqual(['warp', 'comp']);
    expect(rows[0]?.textContent).toContain('[warp_shader]');
    expect(rows[0]?.textContent).toContain('lines 3\u20136');
    expect(rows[1]?.textContent).toContain('[comp_shader]');
    expect(rows[1]?.textContent).toContain('lines 7\u201310');

    rows[0]?.click();
    expect(cursorLine(panel)).toBe(3);
    rows[1]?.click();
    expect(cursorLine(panel)).toBe(7);
    panel.dispose();
  });

  test('a preset without shader blocks says so and points at the docs', () => {
    const panel = mount(PLAIN_SOURCE);
    expect(segmentRows(panel)).toHaveLength(0);
    expect(pane(panel)?.textContent).toContain('No shader blocks');
    expect(pane(panel)?.textContent).toContain('docs/authoring/06-shaders.md');
    panel.dispose();
  });

  test('a broken warp program shows a diagnostic row with a jump', () => {
    clearMilkdropShaderCompileDiagnostics();
    recordBrokenWarpFragment(
      "ERROR: 0:1: 'this_identifier_does_not_exist' : undeclared identifier",
    );
    const panel = mount(SHADER_SOURCE);
    const [row] = diagnosticRows(panel);
    expect(row?.dataset.program).toBe('warp');
    expect(row?.textContent).toContain('warp shader failed to build');
    expect(row?.textContent).toContain('webgl · fragment');
    expect(row?.textContent).toContain('undeclared identifier');
    expect(row?.textContent).toContain('line 3');
    expect(row?.tagName).toBe('BUTTON');

    row?.click();
    expect(cursorLine(panel)).toBe(3);

    // The dock tab counts the failure until it is read.
    const tab = panel.element.querySelector<HTMLElement>(
      '[role="tab"][data-pane="shader"]',
    );
    expect(tab?.textContent).toBe('Shader · 1');
    expect(tab?.dataset.tone).toBe('danger');
    panel.dispose();
  });

  test('a failure outside the feedback chain gets a row without a jump', () => {
    clearMilkdropShaderCompileDiagnostics();
    const renderer = { debug: {} } as {
      debug: {
        onShaderError?: (
          gl: MilkdropWebglShaderErrorContext,
          program: unknown,
          vertexShader: unknown,
          fragmentShader: unknown,
        ) => void;
      };
    };
    installMilkdropWebglShaderErrorTracking(renderer);
    const COMPILE_STATUS = 35714;
    const gl: MilkdropWebglShaderErrorContext = {
      COMPILE_STATUS,
      getShaderParameter: () => false,
      getShaderInfoLog: () => 'custom wave program broke',
      getProgramInfoLog: () => '',
      getShaderSource: () => 'void main() { gl_FragColor = vec4(0.0); }',
    };
    renderer.debug.onShaderError?.(gl, 'program', 'vertex', 'fragment');

    const panel = mount(SHADER_SOURCE);
    const [row] = diagnosticRows(panel);
    expect(row?.dataset.program).toBe('unknown');
    expect(row?.tagName).toBe('DIV');
    expect(row?.textContent).toContain('A shader outside the feedback chain');
    panel.dispose();
  });

  test('no recorded failures shows the clean state', () => {
    clearMilkdropShaderCompileDiagnostics();
    const panel = mount(SHADER_SOURCE);
    expect(diagnosticRows(panel)).toHaveLength(0);
    expect(pane(panel)?.textContent).toContain(
      'No shader compile failures recorded',
    );
    const tab = panel.element.querySelector<HTMLElement>(
      '[role="tab"][data-pane="shader"]',
    );
    expect(tab?.textContent).toBe('Shader');
    expect(tab?.dataset.tone).not.toBe('danger');
    panel.dispose();
  });

  test('a segment can show the GLSL the GPU compiles, read-only', () => {
    const panel = mountCompiled(SHADER_SOURCE);
    const toggle = () =>
      pane(panel)?.querySelector<HTMLButtonElement>(
        '[data-shader-stage="warp"] .stims-editor__outline-glsl',
      );
    const detail = () =>
      pane(panel)?.querySelector<HTMLElement>(
        '[data-shader-stage="warp"] .stims-editor__shader-translation',
      );
    expect(detail()?.hidden).toBe(true);
    toggle()?.click();
    expect(detail()?.hidden).toBe(false);
    const code = detail()?.querySelector('pre');
    // The pane shows lowered GLSL, not the authored HLSL.
    expect(code?.textContent).not.toContain('tex2D(');
    expect(code?.textContent).toContain('texture2D(');
    // An instrument, not a second buffer: the lowered text is a <pre>.
    expect(code?.tagName).toBe('PRE');

    // A repaint (the next keystroke's compile) keeps it open.
    const state: MilkdropEditorSessionState = {
      source: `${SHADER_SOURCE}\n`,
      diagnostics: [],
      latestCompiled: compileMilkdropPresetSource(`${SHADER_SOURCE}\n`, {
        id: 'shader-pane',
      }),
      activeCompiled: compileMilkdropPresetSource(`${SHADER_SOURCE}\n`, {
        id: 'shader-pane',
      }),
      dirty: true,
    };
    panel.setSessionState(state);
    expect(
      pane(panel)?.querySelector<HTMLElement>(
        '[data-shader-stage="warp"] .stims-editor__shader-translation',
      )?.hidden,
    ).toBe(false);
    panel.dispose();
  });

  test('the lowered view names both backends\u2019 execution modes', () => {
    const panel = mountCompiled(SHADER_SOURCE);
    pane(panel)
      ?.querySelector<HTMLButtonElement>(
        '[data-shader-stage="warp"] .stims-editor__outline-glsl',
      )
      ?.click();
    expect(pane(panel)?.textContent).toContain('WebGL runs it as written');
    expect(pane(panel)?.textContent).toContain('WebGPU');
    panel.dispose();
  });
});
