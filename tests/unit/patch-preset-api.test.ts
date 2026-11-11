import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import { applyPresetPatch } from '../../functions/api/patch-preset.ts';

describe('patch-preset API', () => {
  test('patches existing parameter lines in MilkDrop source', () => {
    const source = `[preset00]
fRating=5.000000
wave_r=0.200000
warp=1.000000
`;

    const patched = applyPresetPatch(source, {
      wave_r: 0.8,
      warp: 0.5,
    });

    expect(patched).toContain('wave_r=0.800000');
    expect(patched).toContain('warp=0.500000');
    expect(patched).toContain('fRating=5.000000');
  });

  test('appends new keys not found in original source', () => {
    const source = `[preset00]
fRating=5.000000
`;

    const patched = applyPresetPatch(source, {
      zoom: 1.2,
    });

    expect(patched).toContain('fRating=5.000000');
    expect(patched).toContain('zoom=1.200000');
    expect(patched).toContain('// Agent Parametric Patch');
  });

  test('new keys land before shader sections, where the compiler reads them', () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        'public/milkdrop-presets/butterchurn/royal-mashup-160.milk',
      ),
      'utf8',
    );
    const compile = (milk: string) =>
      compileMilkdropPresetSource(milk, { id: 'royal-mashup-160' }).ir;
    const before = compile(source);
    expect(before.numericFields.warpanimspeed).not.toBe(3.5);

    const after = compile(applyPresetPatch(source, { warpanimspeed: 3.5 }));
    expect(after.numericFields.warpanimspeed).toBe(3.5);
    expect(after.shaderText).toEqual(before.shaderText);
  });
});
