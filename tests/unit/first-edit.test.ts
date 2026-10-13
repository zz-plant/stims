import { beforeEach, describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import { createElement } from 'react';
import { FirstEditGuide } from '../../src/js/frontend/FirstEditGuide.tsx';
import {
  addSpinExample,
  undoSpinExample,
} from '../../src/js/frontend/first-edit.ts';
import {
  type RenderedWorkspace,
  renderWorkspace,
} from '../frontend-harness.tsx';

const SOURCE = '[preset00]\nzoom=1.01\n';
const DISMISSED_KEY = 'stims:first-edit-dismissed';

/** The guide's buttons carry no aria-label; find them by their visible text. */
function buttonWithText(rendered: RenderedWorkspace, label: string) {
  return [...rendered.container.querySelectorAll('button')].find(
    (button) => button.textContent === label,
  );
}

function renderGuide(
  onChange: (source: string) => void = () => {},
  source = SOURCE,
) {
  return renderWorkspace(createElement(FirstEditGuide, { source, onChange }));
}

describe('first edit example', () => {
  test('keeps existing equations and appends a distinct final per-frame line', () => {
    const before =
      '[preset00]\r\n// café 🎛\r\nper_frame_2=rot=bass*0.01;\r\nper_frame_9=zoom=1.01;';
    const edit = addSpinExample(before);
    expect(edit.before).toBe(before);
    expect(edit.after).toBe(`${before}\r\nper_frame_10=rot=rot+0.02;\r\n`);
    const compiled = compileMilkdropPresetSource(edit.after);
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual(
      [],
    );
  });

  test('starts numbering at one for a source with no equations', () => {
    expect(addSpinExample('[preset00]\nzoom=1.01\n').after).toEndWith(
      'per_frame_1=rot=rot+0.02;\n',
    );
  });

  test('undo restores the exact source but refuses to overwrite subsequent edits', () => {
    const edit = addSpinExample('[preset00]\nzoom=1.01\n');
    expect(undoSpinExample(edit.after, edit)).toBe(edit.before);
    expect(undoSpinExample(`${edit.after}// my edit\n`, edit)).toBeNull();
  });
});

describe('first edit guide card', () => {
  beforeEach(() => {
    localStorage.removeItem(DISMISSED_KEY);
  });

  test('a fresh visitor with a preset source sees the card', () => {
    const rendered = renderGuide();
    try {
      const card = rendered.byLabel('Try one edit');
      expect(card).not.toBeNull();
      expect(card?.textContent).toContain('Add a slow spin');
      expect(card?.textContent).toContain('Dismiss');
      expect(card?.textContent).toContain('rot=rot+0.02;');
    } finally {
      rendered.dispose();
    }
  });

  test('an empty source renders nothing', () => {
    const rendered = renderGuide(() => {}, '');
    try {
      expect(rendered.byLabel('Try one edit')).toBeNull();
    } finally {
      rendered.dispose();
    }
  });

  test('Add a slow spin appends the per-frame line and shows the status', () => {
    const seen: string[] = [];
    const rendered = renderGuide((source) => seen.push(source));
    try {
      rendered.click(buttonWithText(rendered, 'Add a slow spin'));
      expect(seen).toEqual([`${SOURCE}per_frame_1=rot=rot+0.02;\n`]);
      const card = rendered.byLabel('Try one edit');
      // The instruction line yields to the result line; the button turned
      // into its own undo.
      expect(card?.textContent).toContain(
        'Spin added. Try changing 0.02, or copy a remix link from the editor toolbar.',
      );
      expect(buttonWithText(rendered, 'Undo example')).not.toBeNull();
    } finally {
      rendered.dispose();
    }
  });

  test('Dismiss writes the storage key and a re-render shows nothing', () => {
    const rendered = renderGuide();
    try {
      rendered.click(buttonWithText(rendered, 'Dismiss'));
    } finally {
      rendered.dispose();
    }
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('1');

    const again = renderGuide();
    try {
      expect(again.byLabel('Try one edit')).toBeNull();
    } finally {
      again.dispose();
    }

    // Without the stored key the card is offered again.
    localStorage.removeItem(DISMISSED_KEY);
    const fresh = renderGuide();
    try {
      expect(fresh.byLabel('Try one edit')).not.toBeNull();
    } finally {
      fresh.dispose();
    }
  });
});
