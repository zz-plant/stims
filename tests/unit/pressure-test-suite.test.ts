import { describe, expect, it } from 'bun:test';
import { WebMidiControllerService } from '../../src/js/core/services/webmidi-controller.ts';
import { parseURLParams } from '../../src/js/core/url-params.ts';
import {
  evaluateMilkdropExpression,
  parseMilkdropExpression,
} from '../../src/js/milkdrop/expression.ts';
import { parseMilkdropPreset } from '../../src/js/milkdrop/preset-parser.ts';

describe('Comprehensive Pressure & Stress Suite', () => {
  describe('1. Math Engine & Expression Boundary Stress', () => {
    it('handles negative base powers without NaN or crash', () => {
      const parsed = parseMilkdropExpression('pow(-0.0001, -99.9)', 1);
      expect(parsed.diagnostics.length).toBe(0);
      if (parsed.value) {
        const result = evaluateMilkdropExpression(
          parsed.value,
          {},
          { nextRandom: () => 0.5 },
        );
        expect(Number.isFinite(result)).toBe(true);
        expect(Number.isNaN(result)).toBe(false);
      }
    });

    it('handles negative square roots without NaN', () => {
      const parsed = parseMilkdropExpression('sqrt(-1e30)', 1);
      expect(parsed.diagnostics.length).toBe(0);
      if (parsed.value) {
        const result = evaluateMilkdropExpression(
          parsed.value,
          {},
          { nextRandom: () => 0.5 },
        );
        expect(result).toBe(0);
      }
    });

    it('handles division by zero cleanly', () => {
      const parsed = parseMilkdropExpression('100 / 0', 1);
      expect(parsed.diagnostics.length).toBe(0);
      if (parsed.value) {
        const result = evaluateMilkdropExpression(
          parsed.value,
          {},
          { nextRandom: () => 0.5 },
        );
        expect(result).toBe(0);
      }
    });

    it('handles modulo by zero cleanly', () => {
      const parsed = parseMilkdropExpression('100 % 0', 1);
      expect(parsed.diagnostics.length).toBe(0);
      if (parsed.value) {
        const result = evaluateMilkdropExpression(
          parsed.value,
          {},
          { nextRandom: () => 0.5 },
        );
        expect(result).toBe(0);
      }
    });

    it('handles out-of-bounds inverse trig functions', () => {
      const asinParsed = parseMilkdropExpression('asin(2.5)', 1);
      if (asinParsed.value) {
        const result = evaluateMilkdropExpression(
          asinParsed.value,
          {},
          { nextRandom: () => 0.5 },
        );
        expect(Number.isFinite(result)).toBe(true);
      }

      const acosParsed = parseMilkdropExpression('acos(-5.0)', 1);
      if (acosParsed.value) {
        const result = evaluateMilkdropExpression(
          acosParsed.value,
          {},
          { nextRandom: () => 0.5 },
        );
        expect(Number.isFinite(result)).toBe(true);
      }
    });

    it('handles log of negative numbers gracefully', () => {
      const logParsed = parseMilkdropExpression('log(-100)', 1);
      if (logParsed.value) {
        const result = evaluateMilkdropExpression(
          logParsed.value,
          {},
          { nextRandom: () => 0.5 },
        );
        expect(result).toBe(0);
      }
    });

    it('handles smoothstep with matching edges', () => {
      const smoothstepParsed = parseMilkdropExpression(
        'smoothstep(1.0, 1.0, 0.5)',
        1,
      );
      if (smoothstepParsed.value) {
        const result = evaluateMilkdropExpression(
          smoothstepParsed.value,
          {},
          { nextRandom: () => 0.5 },
        );
        expect(Number.isFinite(result)).toBe(true);
      }
    });
  });

  describe('2. Preset Parser & AST Deep Nesting Stress', () => {
    it('caps maximum recursion depth on deeply nested parentheses', () => {
      const deepNested = `${'('.repeat(150)}1${')'.repeat(150)}`;
      const parsed = parseMilkdropExpression(deepNested, 1);
      expect(
        parsed.diagnostics.some((d) => d.code === 'expr_max_depth_exceeded'),
      ).toBe(true);
    });

    it('handles presets with 10,000 fields without crashing', () => {
      const lines = ['[preset00]'];
      for (let i = 0; i < 10500; i++) {
        lines.push(`v_${i}=${i * 0.1}`);
      }
      const source = lines.join('\n');
      const { ast, diagnostics } = parseMilkdropPreset(source);
      expect(ast.fields.length).toBeLessThanOrEqual(10000);
      expect(
        diagnostics.some((d) => d.code === 'preset_max_fields_exceeded'),
      ).toBe(true);
    });

    it('truncates giant single lines without memory spikes', () => {
      const giantLine = `warp_1=${'x'.repeat(150_000)}`;
      const { ast } = parseMilkdropPreset(giantLine);
      expect(ast.fields.length).toBe(1);
      expect(ast.fields[0].rawValue.length).toBeLessThanOrEqual(100_000);
    });
  });

  describe('3. High-Frequency MIDI Controller Flooding', () => {
    it('processes 1,000 rapid MIDI CC messages without dropping state', () => {
      const service = new WebMidiControllerService();
      service.bindCc('virtual:claude', 1, 'zoom', 0.8, 1.2);
      let lastValue = 0;
      service.onControlChange((_cc, _raw, target, normalized) => {
        if (target === 'zoom' && normalized !== undefined) {
          lastValue = normalized;
        }
      });

      for (let i = 0; i < 1000; i++) {
        service.injectControlChange('virtual:claude', 1, (i % 127) + 1);
      }

      expect(lastValue).toBeGreaterThan(0.8);
    });
  });

  describe('4. URL Parameter Input Hardening Stress', () => {
    it('parses malformed and malicious URL parameters safely', () => {
      const params = parseURLParams({
        preset: '<script>alert(1)</script>',
        audio: 'invalid_audio_mode',
        zoom: 'NaN',
        panel: 'non_existent_panel',
        youtube: 'too_long_youtube_video_id_123456789',
      });

      expect(params.routing.panel).toBeNull();
      expect(params.routing.audioSource).toBeNull();
      expect(params.routing.youtubeVideoId).toBeNull();
    });
  });
});
