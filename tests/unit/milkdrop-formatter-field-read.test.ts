import { describe, expect, it } from 'bun:test';
import {
  findMilkdropEquationLine,
  findMilkdropFieldLine,
  readMilkdropField,
  upsertMilkdropField,
  upsertMilkdropFields,
} from '../../src/js/milkdrop/formatter.ts';

/**
 * Real .milk files spell almost every scalar the long way — `fOuterBorderR`,
 * `fWaveAlpha`, `nWaveMode` — while the controls, MIDI and MCP all address
 * them by the compiler's short name. Before the upsert layer knew the alias
 * table, a control writing `ob_r` did not find the `fOuterBorderR=` line: it
 * appended a rival assignment, which only happened to work because the
 * compiler takes the last one, and left the buffer with two lines for one
 * value.
 */
describe('alias-aware field addressing', () => {
  const bundledStyleSource = [
    '[preset00]',
    'fRating=5.000000',
    'fDecay=0.995000',
    'fWaveAlpha=0.001000',
    'fOuterBorderR=0.250000',
    'fOuterBorderG=0.500000',
    'fOuterBorderB=0.750000',
    'zoom=1.005485',
    'per_frame_1=wave_r = 0.5 + 0.35*sin(time);',
    '',
    '[warp_shader]',
    'float ob_r = 1.0;',
    '',
  ].join('\n');

  describe('readMilkdropField', () => {
    it('reads a field through its long MilkDrop spelling', () => {
      expect(readMilkdropField(bundledStyleSource, 'ob_r')).toBeCloseTo(
        0.25,
        6,
      );
      expect(readMilkdropField(bundledStyleSource, 'wave_a')).toBeCloseTo(
        0.001,
        6,
      );
      expect(readMilkdropField(bundledStyleSource, 'decay')).toBeCloseTo(
        0.995,
        6,
      );
    });

    it('returns null for a field the preset never declares', () => {
      expect(readMilkdropField(bundledStyleSource, 'mv_a')).toBeNull();
    });

    it('does not read a value out of a shader body', () => {
      // `float ob_r = 1.0;` lives in [warp_shader] and is not a preset field.
      // Reading it would report 1.0 for a border the preset sets to 0.25.
      expect(readMilkdropField(bundledStyleSource, 'ob_r')).not.toBeCloseTo(
        1,
        6,
      );
    });

    it('takes the last assignment, matching the compiler', () => {
      expect(readMilkdropField('zoom=1.0\nzoom=2.5\n', 'zoom')).toBeCloseTo(
        2.5,
        6,
      );
    });

    it('returns null when the value is an expression rather than a number', () => {
      expect(readMilkdropField('zoom=1.0 + bass\n', 'zoom')).toBeNull();
    });
  });

  describe('upsert through an alias', () => {
    it('rewrites the long-spelled line in place instead of appending', () => {
      const next = upsertMilkdropField(bundledStyleSource, 'ob_r', 0.8);

      expect(next).toContain('fOuterBorderR=0.8');
      expect(
        next.split('\n').filter((line) => /^ob_r=/u.test(line)),
      ).toHaveLength(0);
      expect(readMilkdropField(next, 'ob_r')).toBeCloseTo(0.8, 6);
    });

    it('writes a whole colour group as one transaction', () => {
      const next = upsertMilkdropFields(bundledStyleSource, {
        ob_r: 0.1,
        ob_g: 0.2,
        ob_b: 0.3,
      });

      expect(next).toContain('fOuterBorderR=0.1');
      expect(next).toContain('fOuterBorderG=0.2');
      expect(next).toContain('fOuterBorderB=0.3');
    });

    it('keeps a new field out of the shader section', () => {
      // Appending at the end of the buffer would land inside [warp_shader],
      // where the parser swallows the line as shader text.
      const next = upsertMilkdropField(bundledStyleSource, 'mv_a', 1);
      const lines = next.split('\n');

      expect(lines.findIndex((line) => line.startsWith('mv_a='))).toBeLessThan(
        lines.findIndex((line) => line.trim() === '[warp_shader]'),
      );
    });
  });

  describe('findMilkdropFieldLine', () => {
    it('finds the line through the alias spelling', () => {
      expect(findMilkdropFieldLine(bundledStyleSource, 'ob_r')).toBe(5);
    });

    it('points at the last assignment, which is the one that wins', () => {
      expect(findMilkdropFieldLine('zoom=1.0\nzoom=2.5\n', 'zoom')).toBe(2);
    });
  });

  describe('findMilkdropEquationLine', () => {
    it('locates the equation that overwrites a field every frame', () => {
      expect(findMilkdropEquationLine(bundledStyleSource, 'wave_r')).toBe(9);
    });

    it('is null when no equation touches the field', () => {
      expect(findMilkdropEquationLine(bundledStyleSource, 'zoom')).toBeNull();
    });

    it('ignores shader bodies', () => {
      expect(findMilkdropEquationLine(bundledStyleSource, 'ob_r')).toBeNull();
    });
  });
});
