import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import {
  upsertMilkdropField,
  upsertMilkdropFields,
} from '../../src/js/milkdrop/formatter.ts';

/**
 * Every live parameter change — MIDI knob, Tune slider, MCP session_set_fields,
 * inspector nudge — is ultimately text surgery on the preset buffer by these
 * two functions. A miss here does not throw; it writes a second assignment
 * beside the first, and since the compiler takes the LAST assignment, the
 * control silently stops doing anything.
 */
describe('milkdrop field upsert', () => {
  const fieldValue = (source: string, key: string) =>
    compileMilkdropPresetSource(source, { id: 'upsert-probe' }).ir
      .numericFields[key];

  const assignmentsFor = (source: string, key: string) =>
    source
      .split('\n')
      .filter((line) => new RegExp(`^\\s*${key}\\s*=`, 'iu').test(line));

  describe('single-field upsert', () => {
    test('rewrites an assignment written with spaces around the equals', () => {
      // A code editor invites `zoom = 1.0`; prefix matching only ever saw
      // `zoom=`, so the knob appended a rival assignment instead.
      const next = upsertMilkdropField('title=T\nzoom = 1.000\n', 'zoom', 1.35);

      expect(assignmentsFor(next, 'zoom')).toHaveLength(1);
      expect(fieldValue(next, 'zoom')).toBeCloseTo(1.35, 6);
    });

    test('rewrites a field spelled with its alternate MilkDrop name', () => {
      // The Tune slider and MCP both address this field as "decay" while
      // presets carry it as "fDecay".
      const next = upsertMilkdropField(
        'title=T\nfDecay=0.960\n',
        'decay',
        0.98,
      );

      expect(next.match(/decay\s*=/giu)).toHaveLength(1);
      expect(fieldValue(next, 'decay')).toBeCloseTo(0.98, 6);
    });

    test('keeps the spelling the preset already uses', () => {
      const next = upsertMilkdropField(
        'title=T\nfDecay=0.960\n',
        'decay',
        0.98,
      );
      expect(next).toContain('fDecay=0.98');
    });

    test('is case-insensitive about the field name', () => {
      const next = upsertMilkdropField('title=T\nZoom=1.000\n', 'zoom', 1.5);

      expect(assignmentsFor(next, 'zoom')).toHaveLength(1);
      expect(fieldValue(next, 'zoom')).toBeCloseTo(1.5, 6);
    });

    test('adds the field when the preset does not define it', () => {
      const next = upsertMilkdropField('title=T\nwarp=0.5\n', 'zoom', 1.25);
      expect(fieldValue(next, 'zoom')).toBeCloseTo(1.25, 6);
    });
  });

  describe('multi-field upsert', () => {
    test('updates every occurrence so no stale duplicate can win', () => {
      // The compiler takes the last assignment, so updating only the first
      // occurrence leaves the old value in charge.
      const next = upsertMilkdropFields('title=T\nzoom=1.0\nzoom=2.0\n', {
        zoom: 1.5,
      });

      expect(fieldValue(next, 'zoom')).toBeCloseTo(1.5, 6);
    });

    test('rewrites assignments written with spaces around the equals', () => {
      const next = upsertMilkdropFields('title=T\nzoom = 1.000\n', {
        zoom: 1.35,
      });

      expect(assignmentsFor(next, 'zoom')).toHaveLength(1);
      expect(fieldValue(next, 'zoom')).toBeCloseTo(1.35, 6);
    });

    test('rewrites a field spelled with its alternate MilkDrop name', () => {
      const next = upsertMilkdropFields('title=T\nfDecay=0.960\n', {
        decay: 0.98,
      });

      expect(next.match(/decay\s*=/giu)).toHaveLength(1);
      expect(fieldValue(next, 'decay')).toBeCloseTo(0.98, 6);
    });

    test('applies a whole group in one pass', () => {
      const next = upsertMilkdropFields('title=T\nzoom=1.0\nwarp=0.1\n', {
        zoom: 1.4,
        warp: 0.6,
        rot: 0.2,
      });

      expect(fieldValue(next, 'zoom')).toBeCloseTo(1.4, 6);
      expect(fieldValue(next, 'warp')).toBeCloseTo(0.6, 6);
      expect(fieldValue(next, 'rot')).toBeCloseTo(0.2, 6);
    });
  });

  test('a knob turn does not brick the slider that follows it', () => {
    // The regression this whole file exists for. A single-field write used to
    // append a rival `zoom=` line; the next grouped write then updated the
    // *other* one, and since the last assignment wins the control froze —
    // permanently, however many times the user dragged it.
    let source = 'title=T\nzoom = 1.000\nwarp=0.5\n';

    source = upsertMilkdropField(source, 'zoom', 1.2);
    expect(fieldValue(source, 'zoom')).toBeCloseTo(1.2, 6);

    source = upsertMilkdropFields(source, { zoom: 1.8 });
    expect(fieldValue(source, 'zoom')).toBeCloseTo(1.8, 6);

    for (const value of [2.0, 2.2, 2.4]) {
      source = upsertMilkdropFields(source, { zoom: value });
    }
    expect(fieldValue(source, 'zoom')).toBeCloseTo(2.4, 6);
  });

  describe('buffer preservation', () => {
    test('leaves the author’s blank lines alone', () => {
      // Collapsing blank lines renumbers every line below the edit, so the
      // diagnostics the user is reading shift under them mid-fix.
      const source = 'title=T\n\n\n\nzoom=1.0\n';
      const next = upsertMilkdropField(source, 'zoom', 1.5);

      expect(next.indexOf('zoom=1.5')).toBe(source.indexOf('zoom=1.0'));
    });

    test('does not reformat shader bodies', () => {
      const source = [
        'title=T',
        'zoom=1.0',
        '',
        '[warp_shader]',
        'shader_body {',
        '',
        '',
        '   ret = float3(1.0);',
        '}',
        '',
      ].join('\n');

      const next = upsertMilkdropField(source, 'zoom', 1.9);
      const shaderOf = (text: string) =>
        text.slice(text.indexOf('[warp_shader]'));

      expect(shaderOf(next)).toBe(shaderOf(source));
    });

    test('never leaves the buffer without a trailing newline', () => {
      expect(upsertMilkdropField('title=T\nzoom=1.0', 'zoom', 1.5)).toEndWith(
        '\n',
      );
      expect(upsertMilkdropFields('title=T\nzoom=1.0', { rot: 0.5 })).toEndWith(
        '\n',
      );
    });

    test('does not write field lines into the shader section', () => {
      const source = 'title=T\n[warp_shader]\nshader_body { ret = 0; }\n';
      const next = upsertMilkdropField(source, 'zoom', 1.5);

      expect(next.indexOf('zoom=1.5')).toBeLessThan(
        next.indexOf('[warp_shader]'),
      );
    });

    test('does not mistake a shader-body assignment for a preset field', () => {
      const source = [
        'title=T',
        'zoom=1.0',
        '[comp_shader]',
        'shader_body {',
        '   float zoom = 4.0;',
        '   ret = float3(zoom);',
        '}',
        '',
      ].join('\n');

      const next = upsertMilkdropField(source, 'zoom', 1.5);
      expect(next).toContain('float zoom = 4.0;');
      expect(fieldValue(next, 'zoom')).toBeCloseTo(1.5, 6);
    });
  });
});
