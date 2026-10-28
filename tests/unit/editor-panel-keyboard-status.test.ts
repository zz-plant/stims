import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  EditorPanel,
  type EditorPanelCallbacks,
} from '../../src/js/milkdrop/overlay/editor-panel.ts';
import type {
  MilkdropDiagnostic,
  MilkdropEditorSessionState,
} from '../../src/js/milkdrop/types.ts';

/**
 * The editor panel's toolbar, Escape and status line, as a keyboard and a
 * screen reader meet them. Before: Escape out of the code parked focus on
 * Apply, above the code, so the next Tab went back in and indented the
 * preset; no state change was announced, "Holding last good frame"
 * included; and the link control the guide pointed at was in a menu.
 */
describe('editor panel keyboard, toolbar and status', () => {
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

  const callbacks = (): EditorPanelCallbacks => ({
    onEditorSourceChange: mock(() => {}),
    onDuplicatePreset: mock(() => {}),
    onExport: mock(() => {}),
    onDeletePreset: mock(() => {}),
    onRequestImport: mock(() => {}),
    onCopyShareLink: mock(() => {}),
  });

  /** Runs `body` against a panel attached to the document, then removes it. */
  const withPanel = async (body: (panel: EditorPanel) => unknown) => {
    const panel = new EditorPanel(callbacks());
    document.body.append(panel.element);
    try {
      await body(panel);
    } finally {
      panel.dispose();
      panel.element.remove();
    }
  };

  const error = (line: number): MilkdropDiagnostic => ({
    severity: 'error',
    code: 'unclosed_paren',
    message: `Unclosed parenthesis at line ${line}.`,
    line,
  });

  const state = (
    overrides: Partial<MilkdropEditorSessionState> = {},
  ): MilkdropEditorSessionState => ({
    source: 'zoom=1.0\nrot=0.0\n',
    diagnostics: [],
    latestCompiled: null,
    activeCompiled: null,
    dirty: false,
    ...overrides,
  });

  const viewOf = (panel: EditorPanel): EditorView => {
    const dom = panel.element.querySelector<HTMLElement>('.cm-editor');
    const view = dom ? EditorView.findFromDOM(dom) : null;
    if (!view) throw new Error('the panel did not mount its CodeMirror view');
    return view;
  };

  /** A keystroke's worth of text, then the panel's 80ms repaint. */
  const typeAndPause = async (panel: EditorPanel, text: string) => {
    const view = viewOf(panel);
    view.dispatch({
      changes: { from: view.state.doc.length, insert: text },
      annotations: Transaction.userEvent.of('input.type'),
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
  };

  const statusLine = (panel: EditorPanel) =>
    panel.element.querySelector('.stims-editor__state') as HTMLElement;
  /** What assistive tech reads from the status line: its text, minus the
   * parts hidden from it. */
  const heard = (element: HTMLElement) =>
    Array.from(element.childNodes)
      .filter(
        (node) =>
          node.nodeType !== 1 ||
          (node as HTMLElement).getAttribute('aria-hidden') !== 'true',
      )
      .map((node) => node.textContent)
      .join('');

  test('Escape out of the code lands after it, not on Apply above it', () =>
    withPanel((panel) => {
      panel.setSessionState(state());
      const view = viewOf(panel);
      view.contentDOM.focus();
      // happy-dom exposes its constructors on `window`, not on the module's
      // own global scope the way a browser does.
      const KeyboardEventCtor =
        window.KeyboardEvent ?? globalThis.KeyboardEvent;
      view.contentDOM.dispatchEvent(
        new KeyboardEventCtor('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );

      const focused = document.activeElement as HTMLElement | null;
      expect(focused?.closest('.stims-editor__problems')).not.toBeNull();
      expect(focused?.tagName).toBe('BUTTON');
      // Past the code in document order, so Tab moves on to the dock and
      // Shift+Tab is the way back in.
      expect(
        view.dom.compareDocumentPosition(focused as Node) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }));

  test('Copy link is on the toolbar; Jump to variable is in the menu', () =>
    withPanel((panel) => {
      panel.setSessionState(state());
      const toolbar = panel.element.querySelector(
        '.stims-editor__toolbar',
      ) as HTMLElement;
      const menu = toolbar.querySelector('[role="menu"]') as HTMLElement;
      const outsideMenu = Array.from(
        toolbar.querySelectorAll<HTMLButtonElement>('button'),
      ).filter((button) => !menu.contains(button));

      expect(outsideMenu.map((button) => button.textContent)).toContain(
        'Copy link',
      );
      expect(
        outsideMenu.some((button) =>
          button.textContent?.includes('Jump to variable'),
        ),
      ).toBe(false);

      const jump = Array.from(
        menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      ).find((item) => item.textContent?.startsWith('Jump to variable'));
      expect(jump).toBeDefined();
      jump?.click();
      const input = panel.element.querySelector('.stims-editor__jump-input');
      expect(input).not.toBeNull();
      expect(document.activeElement).toBe(input);
    }));

  test('the status line announces errors and their count', () =>
    withPanel((panel) => {
      const line = statusLine(panel);
      expect(line.getAttribute('role')).toBe('status');

      panel.setSessionState(state());
      expect(heard(line)).toBe('Synced');

      panel.setSessionState(state({ dirty: true, diagnostics: [error(1)] }));
      expect(heard(line)).toBe('Holding last good frame: 1 error');

      panel.setSessionState(
        state({ dirty: true, diagnostics: [error(1), error(2)] }),
      );
      expect(heard(line)).toBe('Holding last good frame: 2 errors');

      panel.setSessionState(state({ dirty: true }));
      expect(heard(line)).toBe('Draft live');
    }));

  test('a pause in typing is shown as Queued but not announced', () =>
    withPanel(async (panel) => {
      panel.setSessionState(state({ dirty: true }));
      const line = statusLine(panel);
      const note = panel.element.querySelector(
        '.stims-editor__note',
      ) as HTMLElement;
      expect(note.getAttribute('role')).toBe('status');
      expect(note.textContent).toBe(
        'Draft is live on stage and saved in this browser. Revert restores the original.',
      );

      await typeAndPause(panel, 'warp=0.1\n');

      expect(line.textContent).toContain('Queued');
      expect(heard(line)).toBe('Draft live');
      // The live note keeps saying the draft is live instead of flipping to
      // "Queued" at every pause.
      expect(note.textContent).toBe(
        'Draft is live on stage and saved in this browser. Revert restores the original.',
      );
    }));

  test('the first edit still teaches the apply shortcut', () =>
    withPanel(async (panel) => {
      panel.setSessionState(state());

      await typeAndPause(panel, 'warp=0.1\n');

      const note = panel.element.querySelector(
        '.stims-editor__note',
      ) as HTMLElement;
      expect(note.hidden).toBe(false);
      expect(note.textContent).toBe(
        'Queued — Cmd/Ctrl+Enter punches it in now.',
      );
    }));
});
