import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import {
  computeAstDiagnostics,
  DEFAULT_EDITOR_SLIDERS,
  EditorPanel,
  type EditorPanelCallbacks,
  mergeDiagnostics,
} from '../../src/js/milkdrop/overlay/editor-panel.ts';
import type {
  MilkdropDiagnostic,
  MilkdropEditorSessionState,
  MilkdropPresetSource,
} from '../../src/js/milkdrop/types.ts';

describe('editor panel AST diagnostics & helpers', () => {
  test('computeAstDiagnostics returns no errors for clean EEL preset source', () => {
    const validSource = [
      '[preset]',
      'zoom=1.01',
      'warp=0.05',
      'rot=0.0',
      'per_frame=wave_r = 0.5 + 0.35*sin(time*0.31);',
    ].join('\n');

    const diagnostics = computeAstDiagnostics(validSource);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBe(0);
  });

  test('computeAstDiagnostics detects unclosed parenthesis on EEL equations', () => {
    const sourceWithParenError = [
      '[preset]',
      'zoom=1.01',
      'per_frame=wave_r = 0.5 + 0.35*sin(time*0.31;',
    ].join('\n');

    const diagnostics = computeAstDiagnostics(sourceWithParenError);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.code === 'unclosed_paren')).toBe(true);
    expect(errors.some((e) => e.line === 3)).toBe(true);
  });

  test('computeAstDiagnostics detects unmatched closing parenthesis', () => {
    const sourceWithExtraClosing = ['[preset]', 'zoom=1.01 + 0.05)'].join('\n');

    const diagnostics = computeAstDiagnostics(sourceWithExtraClosing);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.code === 'unmatched_closing_paren')).toBe(true);
  });

  test('mergeDiagnostics combines and deduplicates diagnostics', () => {
    const primary: MilkdropDiagnostic[] = [
      {
        severity: 'error',
        code: 'err_1',
        message: 'Syntax error at line 2',
        line: 2,
      },
    ];
    const secondary: MilkdropDiagnostic[] = [
      {
        severity: 'error',
        code: 'err_1',
        message: 'Syntax error at line 2',
        line: 2,
      },
      { severity: 'warning', code: 'warn_1', message: 'Ignored line', line: 4 },
    ];

    const merged = mergeDiagnostics(primary, secondary);
    expect(merged.length).toBe(2);
    expect(merged[0].code).toBe('err_1');
    expect(merged[1].code).toBe('warn_1');
  });

  test('DEFAULT_EDITOR_SLIDERS contains expected Milkdrop parameters', () => {
    const keys = DEFAULT_EDITOR_SLIDERS.map((s) => s.key);
    expect(keys).toContain('zoom');
    expect(keys).toContain('warp');
    expect(keys).toContain('rot');
    expect(keys).toContain('decay');
    expect(keys).toContain('cx');
    expect(keys).toContain('cy');
    expect(keys).toContain('sx');
    expect(keys).toContain('sy');
    expect(keys).toContain('dx');
    expect(keys).toContain('dy');
    expect(keys).toContain('wave_a');
    expect(keys).toContain('ob_size');
  });
});

describe('EditorPanel class integration', () => {
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

  const createMockCallbacks = (): EditorPanelCallbacks => ({
    onEditorSourceChange: mock(() => {}),
    onRevertToActive: mock(() => {}),
    onDuplicatePreset: mock(() => {}),
    onExport: mock(() => {}),
    onDeletePreset: mock(() => {}),
    onRequestImport: mock(() => {}),
  });

  test('instantiates EditorPanel DOM elements correctly', () => {
    const callbacks = createMockCallbacks();
    const panel = new EditorPanel(callbacks);

    expect(panel.element).toBeDefined();
    expect(panel.element.className).toContain('milkdrop-overlay__tab-panel');

    const slidersRegion = panel.element.querySelector('.editor-sliders');
    expect(slidersRegion).not.toBeNull();

    const diagnosticsContainer = panel.element.querySelector(
      '.milkdrop-overlay__diagnostics',
    );
    expect(diagnosticsContainer).not.toBeNull();

    panel.dispose();
  });

  test('reads and updates variables in editor source correctly', () => {
    const callbacks = createMockCallbacks();
    const panel = new EditorPanel(callbacks);

    const initialState: MilkdropEditorSessionState = {
      source: 'zoom=1.05\nwarp=0.20\nrot=0.00\n',
      diagnostics: [],
      latestCompiled: null,
      activeCompiled: null,
      dirty: false,
    };
    panel.setSessionState(initialState);

    expect(panel.readVariableFromEditor('zoom')).toBeCloseTo(1.05, 2);
    expect(panel.readVariableFromEditor('warp')).toBeCloseTo(0.2, 2);

    // Update existing variable
    panel.writeVariableToEditor('zoom', 1.45);
    expect(panel.readVariableFromEditor('zoom')).toBeCloseTo(1.45, 2);
    expect(callbacks.onEditorSourceChange).toHaveBeenCalledWith(
      expect.stringContaining('zoom=1.450'),
    );

    // Append missing variable
    panel.writeVariableToEditor('dx', 0.15);
    expect(panel.readVariableFromEditor('dx')).toBeCloseTo(0.15, 2);
    expect(panel.getEditorSource()).toContain('dx=0.150');

    panel.dispose();
  });

  test('displays compile error indicators when session state has diagnostics', () => {
    const callbacks = createMockCallbacks();
    const panel = new EditorPanel(callbacks);

    const errorState: MilkdropEditorSessionState = {
      source: 'zoom=1.0\nper_frame=bad_func(\n',
      diagnostics: [
        {
          severity: 'error',
          code: 'unclosed_paren',
          message: "Unclosed parenthesis '(' at line 2.",
          line: 2,
        },
      ],
      latestCompiled: null,
      activeCompiled: null,
      dirty: true,
    };

    panel.setSessionState(errorState);

    const statusEl = panel.element.querySelector(
      '.milkdrop-overlay__editor-status',
    ) as HTMLElement;
    expect(statusEl).not.toBeNull();
    expect(statusEl.textContent).toContain('error');
    expect(
      statusEl.classList.contains('milkdrop-overlay__editor-status--error'),
    ).toBe(true);

    const safetyBadge = panel.element.querySelector(
      '.milkdrop-overlay__editor-badge--safety',
    ) as HTMLElement;
    expect(safetyBadge).not.toBeNull();
    expect(safetyBadge.dataset.tone).toBe('danger');
    expect(safetyBadge.textContent).toContain('issue');

    const diagItem = panel.element.querySelector(
      '.milkdrop-overlay__diagnostic--error',
    );
    expect(diagItem).not.toBeNull();
    expect(diagItem?.textContent).toContain('Line 2');
    expect(diagItem?.textContent).toContain('Unclosed parenthesis');

    const quickFixBtn = panel.element.querySelector(
      '.editor-quick-fix',
    ) as HTMLElement;
    expect(quickFixBtn).not.toBeNull();
    expect(quickFixBtn.style.display).not.toBe('none');

    panel.dispose();
  });

  test('slider double click resets parameter to default value', () => {
    const callbacks = createMockCallbacks();
    const panel = new EditorPanel(callbacks);

    panel.setSessionState({
      source: 'zoom=2.500\n',
      diagnostics: [],
      latestCompiled: null,
      activeCompiled: null,
      dirty: false,
    });

    expect(panel.readVariableFromEditor('zoom')).toBeCloseTo(2.5, 2);

    const zoomLabel = Array.from(
      panel.element.querySelectorAll<HTMLLabelElement>(
        '.editor-slider-row__label',
      ),
    ).find((el) => el.textContent === 'Zoom');

    expect(zoomLabel).toBeDefined();

    const event =
      typeof MouseEvent !== 'undefined'
        ? new MouseEvent('dblclick', { bubbles: true })
        : new Event('dblclick', { bubbles: true });

    zoomLabel?.dispatchEvent(event);

    expect(panel.readVariableFromEditor('zoom')).toBeCloseTo(1.0, 2);
    expect(panel.getEditorSource()).toContain('zoom=1.000');

    panel.dispose();
  });

  const sessionStateFor = (
    raw: string,
    source: Partial<MilkdropPresetSource>,
  ): MilkdropEditorSessionState => {
    const compiled = compileMilkdropPresetSource(raw, source);
    return {
      source: compiled.formattedSource,
      diagnostics: compiled.diagnostics,
      latestCompiled: compiled,
      activeCompiled: compiled,
      dirty: false,
    };
  };

  test('an unsaved draft survives session echoes of the same preset', () => {
    const callbacks = createMockCallbacks();
    const panel = new EditorPanel(callbacks);

    const preset = sessionStateFor('title=Draft Preset\nzoom=1.050\n', {
      id: 'draft-preset',
      title: 'Draft Preset',
      origin: 'user',
    });
    panel.setSessionState(preset);
    panel.writeVariableToEditor('zoom', 1.9);
    expect(panel.getEditorSource()).toContain('zoom=1.900');

    // The compile of an *older* keystroke lands late. It must not yank the
    // buffer out from under the newer draft.
    panel.setSessionState(preset);
    expect(panel.getEditorSource()).toContain('zoom=1.900');

    panel.dispose();
  });

  test('switching presets replaces a buffered draft rather than stranding it', () => {
    const callbacks = createMockCallbacks();
    const panel = new EditorPanel(callbacks);

    panel.setSessionState(
      sessionStateFor('title=Preset A\nzoom=1.050\n', {
        id: 'preset-a',
        title: 'Preset A',
        origin: 'user',
      }),
    );

    // Unsaved local draft belonging to preset A.
    panel.writeVariableToEditor('zoom', 1.9);
    expect(panel.getEditorSource()).toContain('zoom=1.900');

    panel.setSessionState(
      sessionStateFor('title=Preset B\nzoom=0.500\n', {
        id: 'preset-b',
        title: 'Preset B',
        origin: 'bundled',
      }),
    );

    // Holding on to A's draft would leave the editor showing one preset while
    // another renders — and the next keystroke would commit A's text as B.
    expect(panel.getEditorSource()).toContain('Preset B');
    expect(panel.getEditorSource()).not.toContain('Preset A');
    expect(panel.readVariableFromEditor('zoom')).toBeCloseTo(0.5, 2);

    panel.dispose();
  });
});
