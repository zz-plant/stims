import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import { createElement } from 'react';
import { FirstEditGuide } from '../../src/js/frontend/FirstEditGuide.tsx';
import {
  addSpinExample,
  undoSpinExample,
} from '../../src/js/frontend/first-edit.ts';
import type { MilkdropRuntimeSignals } from '../../src/js/milkdrop/types.ts';
import { createMilkdropVM } from '../../src/js/milkdrop/vm.ts';
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
  warpShader?: string | null,
) {
  return renderWorkspace(
    createElement(FirstEditGuide, { source, warpShader, onChange }),
  );
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

/** The source the guide edits: what the editor session holds for a preset. */
function presetSource(file: string): string {
  const raw = readFileSync(`public/milkdrop-presets/${file}.milk`, 'latin1');
  return compileMilkdropPresetSource(raw, { id: file }).formattedSource;
}

/** One stream of equal signals, so two runs differ only by their source. */
function stepSignals(frame: number) {
  return {
    time: frame / 60,
    deltaMs: 1000 / 60,
    frame,
    fps: 60,
    aspect: 16 / 9,
    bass: 1,
    mid: 1,
    treb: 1,
    frequencyData: new Uint8Array(64).fill(128),
    waveformData: new Float32Array(512),
  } as unknown as MilkdropRuntimeSignals;
}

/**
 * What the feedback warp samples on a frame: the per-pixel warp grid when the
 * preset has one, else the rotation the renderer applies uniformly.
 */
function warpOnFrame(source: string, frames = 12) {
  const vm = createMilkdropVM(
    compileMilkdropPresetSource(source, { id: 'first-edit' }),
  );
  let state = vm.step(stepSignals(1));
  for (let frame = 2; frame <= frames; frame += 1) {
    state = vm.step(stepSignals(frame));
  }
  return {
    grid: state.warpField ? Array.from(state.warpField.sampleUvs) : null,
    rot: state.variables.rot as number,
  };
}

function largestChange(before: number[], after: number[]) {
  expect(after.length).toBe(before.length);
  return Math.max(
    ...before.map((value, index) => Math.abs(value - (after[index] as number))),
  );
}

describe('first edit reaches the warp', () => {
  test('per-pixel code that overwrites rot: the spin follows it there', () => {
    // per_pixel_11 assigns rot without reading it, so a per-frame change is
    // gone before the first vertex uses it.
    const source = presetSource('krash-rovastar-cerebral-demons-stars');
    const before = warpOnFrame(source);
    const after = warpOnFrame(addSpinExample(source).after);
    expect(largestChange(before.grid ?? [], after.grid ?? [])).toBeGreaterThan(
      0.001,
    );
  });

  test('a preset ending in shader sections: the line stays out of the shader', () => {
    const source = presetSource('butterchurn/royal-mashup-160');
    const { after } = addSpinExample(source);
    const shaders = (text: string) => {
      const { warp, comp } = compileMilkdropPresetSource(text).ir.shaderText;
      return { warp, comp };
    };
    expect(shaders(after)).toEqual(shaders(source));
    expect(
      largestChange(
        warpOnFrame(source).grid ?? [],
        warpOnFrame(after).grid ?? [],
      ),
    ).toBeGreaterThan(0.001);
  });

  test('shader sections and no per-pixel code: the per-frame rotation moves', () => {
    const source = presetSource('butterchurn/royal-mashup-169');
    const before = warpOnFrame(source);
    const after = warpOnFrame(addSpinExample(source).after);
    expect(before.grid).toBeNull();
    expect(after.grid).toBeNull();
    expect(after.rot - before.rot).toBeCloseTo(0.02, 6);
  });

  test('a preset the old edit already reached: still one per-frame line', () => {
    const source = presetSource('eos-glowsticks-v2-03-music');
    const { after } = addSpinExample(source);
    expect(after).toMatch(/^per_frame_\d+=rot=rot\+0\.02;$/mu);
    expect(after).not.toMatch(/^per_pixel_\d+=rot/mu);
    expect(warpOnFrame(after).rot - warpOnFrame(source).rot).toBeCloseTo(
      0.02,
      6,
    );
  });

  test('per-pixel code that reads rot and writes it back: the spin still adds', () => {
    const source =
      '[preset00]\nper_frame_1=rot=0.1;\nper_pixel_1=rot=rot*rad;\n';
    const { after } = addSpinExample(source);
    expect(after).toBe(`${source}per_pixel_2=rot=rot+0.02;\n`);
    expect(
      largestChange(
        warpOnFrame(source).grid ?? [],
        warpOnFrame(after).grid ?? [],
      ),
    ).toBeGreaterThan(0.001);
  });

  test('undo restores a source whose edit went into the middle of the file', () => {
    const source = presetSource('butterchurn/royal-mashup-160');
    const edit = addSpinExample(source);
    expect(edit.after.endsWith('rot=rot+0.02;\n')).toBe(false);
    expect(undoSpinExample(edit.after, edit)).toBe(source);
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

  test('a warp shader that ignores the warp is not promised a spin', () => {
    const { warp } = compileMilkdropPresetSource(
      presetSource(
        'butterchurn/flexi-kaleidoscope-template-commented-composite-shader',
      ),
    ).ir.shaderText;
    const hidden = renderGuide(() => {}, SOURCE, warp);
    try {
      expect(hidden.byLabel('Try one edit')).toBeNull();
    } finally {
      hidden.dispose();
    }
    const offered = renderGuide(
      () => {},
      SOURCE,
      'shader_body { ret = tex2D(sampler_main, uv).xyz; }',
    );
    try {
      expect(offered.byLabel('Try one edit')).not.toBeNull();
    } finally {
      offered.dispose();
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
      expect(card?.textContent).toContain('Spin added. Try changing 0.02.');
      expect(buttonWithText(rendered, 'Remove the spin')).not.toBeNull();
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
