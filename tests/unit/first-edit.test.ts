import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import {
  addSpinExample,
  undoSpinExample,
} from '../../src/js/frontend/first-edit.ts';

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
