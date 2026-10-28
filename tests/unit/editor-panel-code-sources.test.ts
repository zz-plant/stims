import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { EditorView } from '@codemirror/view';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import {
  EditorPanel,
  type EditorPanelCallbacks,
} from '../../src/js/milkdrop/overlay/editor-panel.ts';
import type { MilkdropEditorSessionState } from '../../src/js/milkdrop/types.ts';

/**
 * The sounds that drive a field, on the lines of code that set it
 * (docs/PRODUCT_MOMENTS.md, "Open one up"). The Tune chips held the claim
 * alone, and on a first open at 1280x720 two of 45 showed; on a phone none.
 * The tags read the same dataflow as the chips, so they are checked against
 * the chip for the same field as well as against the code.
 */
describe('editor panel inline audio sources', () => {
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

  let serial = 0;
  const compiledState = (source: string): MilkdropEditorSessionState => {
    const compiled = compileMilkdropPresetSource(source, {
      id: 'code-sources',
    });
    serial += 1;
    return {
      source,
      diagnostics: [],
      latestCompiled: compiled,
      activeCompiled: compiled,
      dirty: serial > 1,
    };
  };

  const viewOf = (panel: EditorPanel): EditorView => {
    const dom = panel.element.querySelector<HTMLElement>('.cm-editor');
    const view = dom ? EditorView.findFromDOM(dom) : null;
    if (!view) throw new Error('the panel did not mount its CodeMirror view');
    return view;
  };

  /** Each tag with the code on its line, the tag's own text taken out. */
  const tags = (panel: EditorPanel) =>
    Array.from(panel.element.querySelectorAll('.cm-audio-sources')).map(
      (tag) => {
        const line = tag.closest('.cm-line');
        return {
          code: (line?.textContent ?? '').replace(tag.textContent ?? '', ''),
          text: tag.textContent,
        };
      },
    );

  const chipText = (panel: EditorPanel, label: string) =>
    Array.from(panel.element.querySelectorAll('.stims-editor__control-head'))
      .find(
        (head) =>
          head.querySelector('.stims-editor__slider-label')?.textContent ===
          label,
      )
      ?.querySelector('.stims-editor__state-chip')?.textContent;

  const PRESET = [
    '[preset00]',
    'zoom=0.99',
    'rot=0.01',
    'per_frame_1=zoom = 1;',
    'per_frame_2=q1 = 0.9*q1 + 0.1*bass_att;',
    'per_frame_3=zoom = zoom + q1*0.05;',
    'per_frame_4=rot = 0.01*sin(time);',
    '',
  ].join('\n');

  test('the literal and the last assignment carry the chip’s sounds', () => {
    serial = 0;
    const panel = new EditorPanel(callbacks());
    try {
      panel.setSessionState(compiledState(PRESET));

      // zoom follows bass_att through q1, so its literal and the line that
      // leaves zoom with its value say so. `zoom = 1` is overwritten two
      // lines later, and rot follows only the clock.
      expect(tags(panel)).toEqual([
        { code: 'zoom=0.99', text: '← bass_att' },
        { code: 'per_frame_3=zoom = zoom + q1*0.05;', text: '← bass_att' },
      ]);
      expect(chipText(panel, 'Zoom')).toBe('eq · bass_att');
      // The tag is drawn, not typed: the code is unchanged.
      expect(viewOf(panel).state.doc.toString()).toBe(PRESET);
    } finally {
      panel.dispose();
    }
  });

  test('an edit that drops the audio drops the tags once it compiles', () => {
    serial = 0;
    const panel = new EditorPanel(callbacks());
    try {
      panel.setSessionState(compiledState(PRESET));
      expect(tags(panel)).toHaveLength(2);

      const edited = PRESET.replace(
        'per_frame_3=zoom = zoom + q1*0.05;',
        'per_frame_3=zoom = 1.05;',
      );
      panel.setSessionState(compiledState(edited));

      expect(tags(panel)).toEqual([]);
      expect(chipText(panel, 'Zoom')).toBe('eq');
    } finally {
      panel.dispose();
    }
  });

  test('an edit that adds audio adds a tag on the line that does it', () => {
    serial = 0;
    const panel = new EditorPanel(callbacks());
    try {
      panel.setSessionState(compiledState(PRESET));
      const edited = PRESET.replace(
        'per_frame_4=rot = 0.01*sin(time);',
        'per_frame_4=rot = 0.01*sin(time) + 0.02*treb;',
      );
      panel.setSessionState(compiledState(edited));

      expect(tags(panel)).toEqual([
        { code: 'zoom=0.99', text: '← bass_att' },
        { code: 'rot=0.01', text: '← treb' },
        { code: 'per_frame_3=zoom = zoom + q1*0.05;', text: '← bass_att' },
        {
          code: 'per_frame_4=rot = 0.01*sin(time) + 0.02*treb;',
          text: '← treb',
        },
      ]);
    } finally {
      panel.dispose();
    }
  });

  test('a deleted line takes its tag with it before the next compile', () => {
    serial = 0;
    const panel = new EditorPanel(callbacks());
    try {
      panel.setSessionState(compiledState(PRESET));
      const view = viewOf(panel);
      const line = view.state.doc.line(6);
      expect(line.text).toBe('per_frame_3=zoom = zoom + q1*0.05;');
      view.dispatch({ changes: { from: line.from, to: line.to + 1 } });

      expect(tags(panel)).toEqual([{ code: 'zoom=0.99', text: '← bass_att' }]);
    } finally {
      panel.dispose();
    }
  });

  test('a reloaded buffer gets its tags back from the same compile', () => {
    serial = 0;
    const panel = new EditorPanel(callbacks());
    try {
      const state = compiledState(PRESET);
      panel.setSessionState(state);
      // The session hands back different text over the same compile, as a
      // revert of a comment-only edit does: the buffer is replaced whole.
      panel.setSessionState({ ...state, source: `// mine\n${PRESET}` });

      expect(tags(panel)).toEqual([
        { code: 'zoom=0.99', text: '← bass_att' },
        { code: 'per_frame_3=zoom = zoom + q1*0.05;', text: '← bass_att' },
      ]);
    } finally {
      panel.dispose();
    }
  });

  test('each program’s line says what that program leaves in the field', () => {
    serial = 0;
    const panel = new EditorPanel(callbacks());
    try {
      // Per-frame zoom is a constant; per-pixel code adds the bass on top,
      // and that is the zoom the mesh draws, so the literal says bass.
      panel.setSessionState(
        compiledState(
          [
            'zoom=1',
            'per_frame_1=zoom = 1.01;',
            'per_pixel_1=zoom = zoom + bass*rad*0.02;',
            '',
          ].join('\n'),
        ),
      );
      expect(tags(panel)).toEqual([
        { code: 'zoom=1', text: '← bass' },
        { code: 'per_pixel_1=zoom = zoom + bass*rad*0.02;', text: '← bass' },
      ]);
    } finally {
      panel.dispose();
    }
  });

  test('several fields on one line are each named', () => {
    serial = 0;
    const panel = new EditorPanel(callbacks());
    try {
      panel.setSessionState(
        compiledState('per_frame_1=zoom = 1 + bass*0.1; rot = mid*0.01;\n'),
      );
      expect(tags(panel)).toEqual([
        {
          code: 'per_frame_1=zoom = 1 + bass*0.1; rot = mid*0.01;',
          text: 'zoom ← bass · rot ← mid',
        },
      ]);
    } finally {
      panel.dispose();
    }
  });

  test('the tags are left out of what a screen reader reads as the code', () => {
    serial = 0;
    const panel = new EditorPanel(callbacks());
    try {
      panel.setSessionState(compiledState(PRESET));
      const rendered = Array.from(
        panel.element.querySelectorAll('.cm-audio-sources'),
      );
      expect(rendered.length).toBeGreaterThan(0);
      for (const tag of rendered) {
        expect(tag.getAttribute('aria-hidden')).toBe('true');
        expect(tag.getAttribute('title')).toBe(
          'zoom follows bass_att, through the equations on stage.',
        );
      }
    } finally {
      panel.dispose();
    }
  });
});
