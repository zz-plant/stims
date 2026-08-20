import { describe, expect, it } from 'bun:test';
import {
  computeMidiGutterInfo,
  findMilkdropFieldLine,
  getFieldOverwriteKind,
  isFieldShadowedByEquations,
} from '../../src/js/milkdrop/formatter.ts';

describe('isFieldShadowedByEquations', () => {
  it('is false when nothing reassigns the target', () => {
    const source = 'zoom=1.4\nrot=0.0\nper_frame_1=warp = warp + 0.01\n';
    expect(isFieldShadowedByEquations(source, 'zoom')).toBe(false);
  });

  it('is true when a per_frame equation reassigns the target', () => {
    const source = 'zoom=1.4\nper_frame_1=zoom = 1.0 + bass*0.1\n';
    expect(isFieldShadowedByEquations(source, 'zoom')).toBe(true);
  });

  it('is true when a per_pixel equation reassigns the target', () => {
    const source = 'rot=0.2\nper_pixel_1=rot = rot + sin(ang)*0.01\n';
    expect(isFieldShadowedByEquations(source, 'rot')).toBe(true);
  });

  it('is true for a wave_/shape_ equation key', () => {
    const source = 'q1=0.5\nwave_1_r=q1 = q1 + 0.1\n';
    expect(isFieldShadowedByEquations(source, 'q1')).toBe(true);
  });

  it('is false when the equation assigns a different variable', () => {
    const source = 'zoom=1.4\nper_frame_1=warp = 1.0 + bass*0.1\n';
    expect(isFieldShadowedByEquations(source, 'zoom')).toBe(false);
  });

  it('does not match a variable name that only shares a prefix', () => {
    const source = 'zoom=1.4\nper_frame_1=zoom2 = 1.0 + bass*0.1\n';
    expect(isFieldShadowedByEquations(source, 'zoom')).toBe(false);
  });

  it('ignores assignments inside [warp_shader]/[comp_shader] sections', () => {
    const source = 'zoom=1.4\n[warp_shader]\nfloat zoom = 1.0;\n';
    expect(isFieldShadowedByEquations(source, 'zoom')).toBe(false);
  });

  it('matches a second statement after a semicolon within an equation line', () => {
    const source = 'zoom=1.4\nper_frame_1=warp = warp + 0.01; zoom = 1.2;\n';
    expect(isFieldShadowedByEquations(source, 'zoom')).toBe(true);
  });
});

describe('findMilkdropFieldLine', () => {
  it('finds the 1-based line number of the literal default', () => {
    const source = 'fRating=3\nzoom=1.4\nrot=0.0\n';
    expect(findMilkdropFieldLine(source, 'zoom')).toBe(2);
  });

  it('returns null when there is no default line for the target', () => {
    const source = 'fRating=3\nper_frame_1=zoom = 1.0 + bass*0.1\n';
    expect(findMilkdropFieldLine(source, 'zoom')).toBeNull();
  });

  it('does not match inside a shader section', () => {
    const source = '[warp_shader]\nfloat zoom = 1.0;\n';
    expect(findMilkdropFieldLine(source, 'zoom')).toBeNull();
  });
});

describe('computeMidiGutterInfo', () => {
  it('reports live and shadowed targets, skipping ones with no default line', () => {
    const source = [
      'zoom=1.4',
      'warp=1.0',
      'per_frame_1=zoom = 1.0 + bass*0.1',
    ].join('\n');

    const entries = computeMidiGutterInfo(source, ['zoom', 'warp', 'q1']);
    expect(entries).toEqual([
      { line: 1, target: 'zoom', status: 'shadowed' },
      { line: 2, target: 'warp', status: 'live' },
    ]);
  });

  it('deduplicates repeated targets', () => {
    const source = 'zoom=1.4\n';
    const entries = computeMidiGutterInfo(source, ['zoom', 'zoom']);
    expect(entries).toHaveLength(1);
  });
});

describe('getFieldOverwriteKind', () => {
  it('is "none" when nothing reassigns the target', () => {
    const source = 'zoom=1.4\nper_frame_1=warp = warp + 0.01\n';
    expect(getFieldOverwriteKind(source, 'zoom')).toBe('none');
  });

  it('is "absolute" when the equation discards the base', () => {
    const source = 'zoom=1.4\nper_frame_1=zoom = 1.0 + bass*0.1\n';
    expect(getFieldOverwriteKind(source, 'zoom')).toBe('absolute');
  });

  it('is "relative" when the equation references its own target', () => {
    const source = 'cx=0.5\nper_frame_1=cx = cx + sin(time)*0.01\n';
    expect(getFieldOverwriteKind(source, 'cx')).toBe('relative');
  });

  it('is "relative" for a compound self-reference after a semicolon', () => {
    const source = 'zoom=1.4\nper_frame_1=warp = 1.0; zoom = zoom * 1.01\n';
    expect(getFieldOverwriteKind(source, 'zoom')).toBe('relative');
  });

  it('keeps the flavour of the last assignment, since it wins', () => {
    const relativeThenAbsolute =
      'zoom=1.4\nper_frame_1=zoom = zoom * 1.01; zoom = 1.0 + bass*0.1\n';
    expect(getFieldOverwriteKind(relativeThenAbsolute, 'zoom')).toBe(
      'absolute',
    );

    const absoluteThenRelative =
      'zoom=1.4\nper_frame_1=zoom = 1.0 + bass*0.1; zoom = zoom * 1.01\n';
    expect(getFieldOverwriteKind(absoluteThenRelative, 'zoom')).toBe(
      'relative',
    );
  });

  it('does not treat a same-prefix variable as a self-reference', () => {
    const source = 'zoom=1.4\nper_frame_1=zoom2 = zoom2 * 1.01\n';
    expect(getFieldOverwriteKind(source, 'zoom')).toBe('none');
  });
});
