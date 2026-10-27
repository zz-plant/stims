import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { EditorPanel } from '../../src/js/milkdrop/overlay/editor-panel.ts';
import {
  getRenderIsolation,
  toggleSolo,
} from '../../src/js/milkdrop/render-isolation.ts';
import type { MilkdropEditorSessionState } from '../../src/js/milkdrop/types.ts';

/**
 * Editor buttons whose outcome used to differ from what they said: a delete
 * with no second chance, AI requests that failed or fell back in silence,
 * results that were dropped, a download that was not the editor's code, and
 * hidden stage elements that outlived the editor.
 */

const SOURCE = 'title=Alpha\nzoom=1.000\nrot=0.000\n';

let OriginalMutationObserver: typeof globalThis.MutationObserver;
const originalFetch = globalThis.fetch;
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
  globalThis.fetch = originalFetch;
});

function mount(state: Partial<MilkdropEditorSessionState> = {}) {
  const callbacks = {
    onEditorSourceChange: mock((_source: string) => {}),
    onDuplicatePreset: mock(() => {}),
    onExport: mock(() => {}),
    onDeletePreset: mock(() => {}),
    onRequestImport: mock(() => {}),
    onCopyShareLink: mock(() => {}),
  };
  const panel = new EditorPanel(callbacks);
  document.body.appendChild(panel.element);
  panel.setSessionState({
    source: SOURCE,
    diagnostics: [],
    latestCompiled: null,
    activeCompiled: null,
    dirty: false,
    ...state,
  });
  const buttonByText = (text: string) =>
    [...panel.element.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === text,
    );
  const notice = () =>
    panel.element.querySelector('.stims-editor__action-notice')?.textContent ??
    '';
  const dispose = () => {
    panel.dispose();
    panel.element.remove();
  };
  return { panel, callbacks, buttonByText, notice, dispose };
}

function stubFetch(respond: () => Response | Promise<Response>) {
  globalThis.fetch = mock(async () => respond()) as unknown as typeof fetch;
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Delete preset', () => {
  test('the first press only arms it', () => {
    const { panel, callbacks, dispose } = mount();
    const remove = panel.element.querySelector<HTMLButtonElement>(
      '[data-action="editor-delete-preset"]',
    );
    remove?.click();
    expect(callbacks.onDeletePreset).not.toHaveBeenCalled();
    expect(remove?.textContent).toBe('Delete for good');
    remove?.click();
    expect(callbacks.onDeletePreset).toHaveBeenCalledTimes(1);
    dispose();
  });
});

describe('Download .milk file', () => {
  test('says when the file is the last version that ran, not the editor', () => {
    const { buttonByText, callbacks, notice, dispose } = mount({
      diagnostics: [
        { severity: 'error', code: 'x', message: 'broken', line: 2 },
      ],
    });
    buttonByText('Download .milk file')?.click();
    expect(callbacks.onExport).toHaveBeenCalledTimes(1);
    expect(notice()).toContain('last version that ran');
    dispose();
  });
});

describe('Solo and Mute', () => {
  test('end when the editor closes', () => {
    const { dispose } = mount();
    toggleSolo('alpha', { kind: 'wave', index: 1 });
    expect(getRenderIsolation()).not.toBeNull();
    dispose();
    expect(getRenderIsolation()).toBeNull();
  });
});

describe('AI actions', () => {
  test('every returned preset can be reviewed, not just the first', async () => {
    const presets = ['title=One\n', 'title=Two\n', 'title=Three\n'];
    stubFetch(() => Response.json({ presets }));
    const { buttonByText, panel, dispose } = mount();
    buttonByText('New presets from this, with AI')?.click();
    await settle();
    expect(panel.element.textContent).toContain('New preset 1 of 3');
    buttonByText('Review 3')?.click();
    expect(panel.element.textContent).toContain('New preset 3 of 3');
    expect(panel.element.textContent).toContain('title=Three');
    dispose();
  });

  test('Explain says when the AI did not answer', async () => {
    stubFetch(() => new Response('down', { status: 503 }));
    const { buttonByText, panel, dispose } = mount();
    buttonByText('Explain with AI')?.click();
    await settle();
    expect(
      panel.element.querySelector('.stims-editor__explanation')?.textContent,
    ).toContain('The AI service did not answer');
    dispose();
  });

  test('a blend made without the AI is labelled as such', async () => {
    stubFetch(() => {
      throw new Error('offline');
    });
    const { buttonByText, panel, dispose } = mount();
    const textarea = panel.element.querySelector<HTMLTextAreaElement>(
      '.stims-editor__assist-textarea',
    );
    if (!textarea) throw new Error('no blend input');
    textarea.value = 'title=Other\nzoom=0.5\n';
    buttonByText('Blend with AI')?.click();
    await settle();
    expect(panel.element.textContent).toContain(
      'Blend made in this browser (the AI service did not answer)',
    );
    dispose();
  });

  test('a failed Fix with AI says the fix never arrived', async () => {
    stubFetch(() => new Response('down', { status: 500 }));
    const { notice, panel, dispose } = mount({
      diagnostics: [
        { severity: 'error', code: 'x', message: 'broken', line: 2 },
      ],
    });
    panel.element
      .querySelector<HTMLButtonElement>('.stims-editor__fix')
      ?.click();
    await settle();
    expect(notice()).toContain('did not send a fix');
    dispose();
  });
});
