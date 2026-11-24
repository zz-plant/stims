import { describe, expect, test } from 'bun:test';
import {
  buildInspectResult,
  drivingControls,
  isCanvasInspectorActive,
  pixelToCoords,
  scaleAboutNeutral,
  toggleCanvasInspectorForSource,
} from '../../src/js/milkdrop/overlay/canvas-inspector.ts';

describe('canvas inspector', () => {
  test('pixelToCoords normalizes and computes rad/ang', () => {
    const c = pixelToCoords(0, 0, 100, 100);
    expect(c.u).toBe(0);
    expect(c.v).toBe(0);
    expect(c.x).toBe(-1);
    expect(c.y).toBe(1);
    expect(c.rad).toBeCloseTo(Math.sqrt(2), 5);
  });

  test('pixelToCoords center', () => {
    const c = pixelToCoords(50, 50, 100, 100);
    expect(c.u).toBe(0.5);
    expect(c.v).toBe(0.5);
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
    expect(c.rad).toBe(0);
  });

  test('drivingControls from perPixelOutputs', () => {
    const df = {
      drawnAudio: {
        perPixel: ['rot', 'zoom'],
        perPixelOutputs: new Map([
          ['rot', ['mid']],
          ['zoom', ['bass']],
        ]),
        waves: [],
        shapes: [],
      },
    } as any;
    const c = drivingControls(df);
    expect(c).toHaveLength(2);
    expect(c.find((x) => x.name === 'rot')?.audio).toEqual(['mid']);
  });

  test('drivingControls falls back to perPixel', () => {
    const df = {
      drawnAudio: {
        perPixel: ['warp'],
        perPixelOutputs: new Map(),
        waves: [],
        shapes: [],
      },
    } as any;
    const c = drivingControls(df);
    expect(c).toHaveLength(1);
    expect(c[0].name).toBe('warp');
    expect(c[0].audio).toEqual([]);
  });

  test('buildInspectResult combines', () => {
    const df = null;
    const r = buildInspectResult(10, 20, 100, 100, df);
    expect(r.coords.u).toBeCloseTo(0.1, 5);
    expect(r.controls).toEqual([]);
  });

  test('null dataflow yields empty controls', () => {
    expect(drivingControls(null)).toEqual([]);
  });
});

describe('canvas inspector toggle helper', () => {
  test('compiles the source, toggles on and off without throwing', () => {
    const stage = document.createElement('div');
    const canvas = document.createElement('canvas');
    stage.appendChild(canvas);
    document.body.appendChild(stage);
    const on = toggleCanvasInspectorForSource(
      stage,
      'per_frame_1=zoom=1;',
      'test-preset',
    );
    expect(on).toBe(true);
    expect(isCanvasInspectorActive()).toBe(true);
    const off = toggleCanvasInspectorForSource(stage, null, null);
    expect(off).toBe(false);
    expect(isCanvasInspectorActive()).toBe(false);
    stage.remove();
  });
});

describe('canvas inspector card', () => {
  const PRESET = [
    'zoom=1.04',
    'rot=0.02',
    'per_pixel_1=zoom = zoom + 0.02*bass;',
    'per_pixel_2=rot = rot + 0.01*rad;',
  ].join('\n');

  const mount = (
    hooks: Parameters<typeof toggleCanvasInspectorForSource>[3],
  ) => {
    const stage = document.createElement('div');
    const canvas = document.createElement('canvas');
    stage.appendChild(canvas);
    document.body.appendChild(stage);
    toggleCanvasInspectorForSource(stage, PRESET, 'card-test', hooks);
    canvas.dispatchEvent(
      new window.MouseEvent('click', { clientX: 5, clientY: 5 }),
    );
    return {
      stage,
      slider: (name: string) =>
        stage.querySelector<HTMLInputElement>(
          `input[aria-label="Scale ${name}"]`,
        ),
      edit: (name: string) =>
        stage.querySelector<HTMLButtonElement>(
          `button[aria-label="Edit the code for ${name}"]`,
        ),
      done: () => {
        toggleCanvasInspectorForSource(stage, null, null);
        stage.remove();
      },
    };
  };

  test('the slider scales the preset value about its neutral point', () => {
    const applied: Array<[string, number]> = [];
    const base: Record<string, number> = { zoom: 1.04, rot: 0.02 };
    const view = mount({
      readBase: (control) => base[control],
      setLive: (control, value) => applied.push([control, value]),
    });
    const zoom = view.slider('zoom');
    const rot = view.slider('rot');
    expect(zoom).not.toBeNull();
    expect(rot).not.toBeNull();
    for (const [input, value] of [
      [zoom, '0'],
      [zoom, '2'],
      [rot, '0'],
      [rot, '2'],
    ] as const) {
      if (!input) throw new Error('slider missing');
      input.value = value;
      input.dispatchEvent(new window.Event('input'));
    }
    expect(applied[0][0]).toBe('zoom');
    expect(applied[0][1]).toBeCloseTo(1, 6);
    expect(applied[1][1]).toBeCloseTo(1.08, 6);
    expect(applied[2]).toEqual(['rot', 0]);
    expect(applied[3][1]).toBeCloseTo(0.04, 6);
    view.done();
  });

  test('a control its code sets from scratch gets a note, not a slider', () => {
    const stage = document.createElement('div');
    const canvas = document.createElement('canvas');
    stage.appendChild(canvas);
    document.body.appendChild(stage);
    toggleCanvasInspectorForSource(
      stage,
      'rot=0.1\nper_frame_1=rot = 0.1;\nper_pixel_1=rot = rot + 0.01*rad;',
      'scratch-test',
      { readBase: () => 0.1, setLive: () => {} },
    );
    canvas.dispatchEvent(
      new window.MouseEvent('click', { clientX: 5, clientY: 5 }),
    );
    expect(stage.querySelector('input[aria-label="Scale rot"]')).toBeNull();
    expect(stage.textContent).toContain('sets these from scratch each frame');
    toggleCanvasInspectorForSource(stage, null, null);
    stage.remove();
  });

  test('no slider for a control whose base cannot be read', () => {
    const view = mount({ readBase: () => undefined, setLive: () => {} });
    expect(view.slider('zoom')).toBeNull();
    view.done();
  });

  test('Edit code hands over the control name', () => {
    const edited: string[] = [];
    const view = mount({ editCode: (control) => edited.push(control) });
    view.edit('rot')?.click();
    expect(edited).toEqual(['rot']);
    view.done();
  });

  test('scaleAboutNeutral keeps identity at 1x', () => {
    expect(scaleAboutNeutral('zoom', 0.97, 1)).toBeCloseTo(0.97, 6);
    expect(scaleAboutNeutral('dx', -0.01, 1)).toBeCloseTo(-0.01, 6);
    expect(scaleAboutNeutral('sx', 1.2, 0)).toBe(1);
  });
});
