import { describe, expect, it } from 'bun:test';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import {
  formatModulation,
  type Modulation,
  readModulation,
  writeModulation,
} from '../../src/js/milkdrop/preset-modulation.ts';

/**
 * This module edits the preset's own code, so the bar is higher than for a
 * control that writes a literal: a wrong rewrite silently drops statements
 * the user wrote. Every test here either checks that we leave code alone, or
 * that what we produce still compiles to the value we claimed.
 */
describe('preset modulation', () => {
  const compiledPerFrame = (source: string) =>
    compileMilkdropPresetSource(source, { id: 'mod-probe' }).ir.programs
      .perFrame.sourceLines;

  describe('readModulation', () => {
    it('reports none when no equation touches the field', () => {
      expect(readModulation('zoom=1.2\n', 'zoom')).toEqual({ kind: 'none' });
    });

    it('parses an additive modulation it wrote', () => {
      const state = readModulation(
        'zoom=1\nper_frame_1=zoom = 1.02 + 0.08*bass_att\n',
        'zoom',
      );
      expect(state.kind).toBe('modulated');
      if (state.kind !== 'modulated') return;
      expect(state.modulation).toEqual({
        base: 1.02,
        depth: 0.08,
        mode: 'add',
        source: 'bass_att',
      });
      expect(state.line).toBe(2);
    });

    it('parses a multiplicative modulation it wrote', () => {
      const state = readModulation(
        'per_frame_1=warp = 0.5*(1 + 0.4*treb_att)\n',
        'warp',
      );
      expect(state.kind).toBe('modulated');
      if (state.kind !== 'modulated') return;
      expect(state.modulation.mode).toBe('multiply');
      expect(state.modulation.base).toBeCloseTo(0.5, 6);
      expect(state.modulation.depth).toBeCloseTo(0.4, 6);
    });

    it('reports custom for an equation it did not author', () => {
      const state = readModulation(
        'per_frame_1=zoom = 1.0 + 0.1*sin(time*0.7) + bass\n',
        'zoom',
      );
      expect(state.kind).toBe('custom');
    });

    it('reports custom when the line packs several statements', () => {
      // Rewriting this line would drop the rot assignment beside it.
      const state = readModulation(
        'per_frame_1=zoom = 1.0 + 0.1*bass_att; rot = rot + 0.01\n',
        'zoom',
      );
      expect(state.kind).toBe('custom');
    });

    it('rejects a source that is not a known signal', () => {
      const state = readModulation('per_frame_1=zoom = 1.0 + 0.1*q3\n', 'zoom');
      expect(state.kind).toBe('custom');
    });

    it('ignores assignments inside shader sections', () => {
      const state = readModulation(
        'zoom=1\n[warp_shader]\nper_frame_1=zoom = 1.0 + 0.1*bass_att\n',
        'zoom',
      );
      expect(state.kind).toBe('none');
    });
  });

  describe('writeModulation', () => {
    const mod: Modulation = {
      base: 1.0,
      depth: 0.08,
      mode: 'add',
      source: 'bass_att',
    };

    it('adds a per_frame line to a preset that had none', () => {
      const next = writeModulation('title=T\nzoom=1.0\n', 'zoom', mod);

      expect(compiledPerFrame(next)).toEqual(['zoom = 1 + 0.08*bass_att']);
      expect(readModulation(next, 'zoom').kind).toBe('modulated');
    });

    it('keeps the new line out of the shader section', () => {
      const next = writeModulation(
        'zoom=1.0\n\n[warp_shader]\nfloat x = 1.0;\n',
        'zoom',
        mod,
      );
      const lines = next.split('\n');

      expect(
        lines.findIndex((line) => line.startsWith('per_frame_')),
      ).toBeLessThan(
        lines.findIndex((line) => line.trim() === '[warp_shader]'),
      );
      expect(compiledPerFrame(next)).toHaveLength(1);
    });

    it('runs after the preset’s existing per_frame lines', () => {
      // Last assignment wins, so a modulation added ahead of the preset's own
      // code would be silently overwritten by it.
      const next = writeModulation(
        'per_frame_1=rot = rot + 0.01\nper_frame_2=warp = 1.0\n',
        'zoom',
        mod,
      );
      const lines = compiledPerFrame(next);

      expect(lines).toHaveLength(3);
      expect(lines[2]).toContain('zoom');
    });

    it('replaces its own line in place rather than stacking', () => {
      const once = writeModulation('zoom=1.0\n', 'zoom', mod);
      const twice = writeModulation(once, 'zoom', { ...mod, depth: 0.3 });

      expect(compiledPerFrame(twice)).toEqual(['zoom = 1 + 0.3*bass_att']);
    });

    it('removes the line when passed null', () => {
      const once = writeModulation(
        'per_frame_1=rot = rot + 0.01\n',
        'zoom',
        mod,
      );
      const removed = writeModulation(once, 'zoom', null);

      expect(compiledPerFrame(removed)).toEqual(['rot = rot + 0.01']);
    });

    it('renumbers the block so no index is skipped or repeated', () => {
      const source = [
        'per_frame_1=rot = rot + 0.01',
        'per_frame_2=zoom = 1 + 0.08*bass_att',
        'per_frame_3=warp = 1.0',
        '',
      ].join('\n');
      const removed = writeModulation(source, 'zoom', null);

      expect(removed).toContain('per_frame_1=rot = rot + 0.01');
      expect(removed).toContain('per_frame_2=warp = 1.0');
      expect(removed).not.toContain('per_frame_3');
      expect(compiledPerFrame(removed)).toHaveLength(2);
    });

    it('refuses to touch an equation it did not author', () => {
      const source = 'per_frame_1=zoom = 1.0 + 0.1*sin(time) + bass\n';
      expect(writeModulation(source, 'zoom', mod)).toBe(source);
      expect(writeModulation(source, 'zoom', null)).toBe(source);
    });

    it('is a no-op when removing a modulation that was never there', () => {
      const source = 'zoom=1.0\n';
      expect(writeModulation(source, 'zoom', null)).toBe(source);
    });
  });

  describe('formatModulation', () => {
    it('makes depth 0 the identity in both modes', () => {
      // The control's zero position has to mean the same thing in each mode,
      // or switching mode silently changes the rendered value.
      expect(
        formatModulation('zoom', {
          base: 1.4,
          depth: 0,
          mode: 'add',
          source: 'bass_att',
        }),
      ).toBe('zoom = 1.4 + 0*bass_att');
      expect(
        formatModulation('zoom', {
          base: 1.4,
          depth: 0,
          mode: 'multiply',
          source: 'bass_att',
        }),
      ).toBe('zoom = 1.4*(1 + 0*bass_att)');
    });

    it('round-trips through readModulation', () => {
      for (const mode of ['add', 'multiply'] as const) {
        const modulation: Modulation = {
          base: 0.75,
          depth: -0.25,
          mode,
          source: 'mid_att',
        };
        const source = `per_frame_1=${formatModulation('warp', modulation)}\n`;
        const state = readModulation(source, 'warp');
        expect(state.kind).toBe('modulated');
        if (state.kind !== 'modulated') continue;
        expect(state.modulation).toEqual(modulation);
      }
    });
  });
});
