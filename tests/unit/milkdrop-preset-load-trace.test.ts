import { describe, expect, test } from 'bun:test';
import { createPresetLoadTrace } from '../../src/js/milkdrop/runtime/preset-load-trace.ts';

describe('preset load trace', () => {
  test('records diagnostics and computes category breakdowns', () => {
    const trace = createPresetLoadTrace('test-preset');

    trace.recordDiagnostics([
      {
        severity: 'warning',
        category: 'parse',
        code: 'preset_line_ignored',
        message: 'Ignored line without an assignment',
        line: 10,
      },
      {
        severity: 'error',
        category: 'eel-compile',
        code: 'expr_unexpected_character',
        message: 'Unexpected character @',
        line: 25,
      },
      {
        severity: 'warning',
        category: 'backend-compat',
        code: 'unsupported_feature',
        message: 'Custom waves not supported',
      },
    ]);

    const result = trace.done('loaded with issues');

    expect(result.presetId).toBe('test-preset');
    expect(result.diagnostics).toHaveLength(3);
    expect(result.categoryBreakdown).toEqual({
      parse: { errors: 0, warnings: 1, info: 0 },
      'eel-compile': { errors: 1, warnings: 0, info: 0 },
      'backend-compat': { errors: 0, warnings: 1, info: 0 },
    });
  });
});
