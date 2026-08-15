import { describe, expect, test } from 'bun:test';
import { StringStream } from '@codemirror/language';
import { initAgentBridge } from '../../src/js/frontend/agent-bridge.ts';
import {
  findMilkdropEquationLine,
  isFieldShadowedByEquations,
  readMilkdropField,
  upsertMilkdropFields,
} from '../../src/js/milkdrop/formatter.ts';
import { milkdropParser } from '../../src/js/milkdrop/overlay/editor-language.ts';
import { computeAstDiagnostics } from '../../src/js/milkdrop/overlay/editor-panel.ts';
import { computeSourceDiff } from '../../src/js/milkdrop/overlay/source-diff.ts';

describe('Code Editing Tooling Hardening: Source Diff', () => {
  test('handles CRLF vs LF line ending equivalence without full-document replacement', () => {
    const unixSource = 'zoom=1.0\nwarp=0.5\ndecay=0.98\n';
    const windowsSource = 'zoom=1.0\r\nwarp=0.5\r\ndecay=0.98\r\n';

    const diff = computeSourceDiff(unixSource, windowsSource);
    expect(diff).toEqual([]);
  });

  test('accurately pinpoints single-line changes across CRLF source', () => {
    const before = 'zoom=1.0\r\nwarp=0.5\r\ndecay=0.98\r\n';
    const after = 'zoom=1.0\nwarp=0.8\ndecay=0.98\n';

    const diff = computeSourceDiff(before, after);
    const dels = diff.filter((d) => d.kind === 'del');
    const adds = diff.filter((d) => d.kind === 'add');

    expect(dels.length).toBe(1);
    expect(dels[0]?.text).toBe('warp=0.5');
    expect(adds.length).toBe(1);
    expect(adds[0]?.text).toBe('warp=0.8');
  });
});

describe('Code Editing Tooling Hardening: Syntax Highlighter', () => {
  function tokenizeString(input: string) {
    const stream = new StringStream(input, 2, 0);
    const state = milkdropParser.startState
      ? milkdropParser.startState(0)
      : { afterEquals: false };
    const tokens: Array<{ text: string; type: string | null }> = [];

    while (!stream.eol()) {
      const pos = stream.pos;
      const type = milkdropParser.token(stream, state);
      if (stream.pos === pos) {
        stream.next();
      }
      tokens.push({ text: stream.string.slice(pos, stream.pos), type });
    }
    return tokens;
  }

  test('tokenizes comments with leading indentation', () => {
    const tokens = tokenizeString('  // indented comment');
    const commentToken = tokens.find((t) => t.type === 'comment');
    expect(commentToken).toBeDefined();
    expect(commentToken?.text.trim()).toBe('// indented comment');
  });

  test('tokenizes inline comments after assignment', () => {
    const tokens = tokenizeString('zoom = 1.0 // trailing note');
    const commentToken = tokens.find((t) => t.type === 'comment');
    expect(commentToken).toBeDefined();
    expect(commentToken?.text.trim()).toBe('// trailing note');
  });

  test('tokenizes hash comments', () => {
    const tokens = tokenizeString('# hash style comment');
    const commentToken = tokens.find((t) => t.type === 'comment');
    expect(commentToken).toBeDefined();
    expect(commentToken?.text).toBe('# hash style comment');
  });

  test('tokenizes numbers starting with decimal point and scientific notation', () => {
    const dotTokens = tokenizeString('zoom = .5');
    const dotNum = dotTokens.find((t) => t.type === 'number');
    expect(dotNum?.text).toBe('.5');

    const sciTokens = tokenizeString('warp = 1e-4');
    const sciNum = sciTokens.find((t) => t.type === 'number');
    expect(sciNum?.text).toBe('1e-4');
  });

  test('tokenizes section headings with surrounding whitespace', () => {
    const tokens = tokenizeString('  [ warp_shader ]  ');
    const heading = tokens.find((t) => t.type === 'heading');
    expect(heading).toBeDefined();
  });
});

describe('Code Editing Tooling Hardening: Formatter & Field Scanning', () => {
  test('detects case-insensitive equation shadowing', () => {
    const sourceUpper = 'zoom=1.0\nper_frame_1=ZOOM = ZOOM + 0.1;\n';
    expect(isFieldShadowedByEquations(sourceUpper, 'zoom')).toBe(true);
    expect(findMilkdropEquationLine(sourceUpper, 'zoom')).toBe(2);

    const sourceMixed = 'rot=0.0\nper_pixel_1=Rot = time * 0.1;\n';
    expect(isFieldShadowedByEquations(sourceMixed, 'rot')).toBe(true);
    expect(findMilkdropEquationLine(sourceMixed, 'rot')).toBe(2);
  });

  test('ignores commented-out equations when checking shadowing', () => {
    const sourceCommented = 'zoom=1.0\n// per_frame_1=zoom = zoom + 0.1;\n';
    expect(isFieldShadowedByEquations(sourceCommented, 'zoom')).toBe(false);
    expect(findMilkdropEquationLine(sourceCommented, 'zoom')).toBeNull();
  });

  test('ignores inline comments when checking shadowing', () => {
    const sourceInline = 'zoom=1.0\nper_frame_1=decay = 0.99; // zoom = 2.0\n';
    expect(isFieldShadowedByEquations(sourceInline, 'zoom')).toBe(false);
  });

  test('reads numeric fields with trailing comments', () => {
    const sourceWithComments =
      'zoom=1.25 // custom zoom\ndecay=0.98 # decay rate\n';
    expect(readMilkdropField(sourceWithComments, 'zoom')).toBe(1.25);
    expect(readMilkdropField(sourceWithComments, 'decay')).toBe(0.98);
  });

  test('upsertMilkdropFields cleanly updates fields while preserving comment structure', () => {
    const initial = 'zoom=1.0 // initial\nwarp=0.5\n';
    const updated = upsertMilkdropFields(initial, { zoom: 1.5 });
    expect(updated).toContain('zoom=1.5');
    expect(updated).toContain('warp=0.5');
  });
});

describe('Code Editing Tooling Hardening: AST Diagnostics', () => {
  test('does not report syntax errors on HLSL code in shader blocks', () => {
    const sourceWithShader = `
zoom=1.0
warp=0.2

[warp_shader]
shader_body {
  float3 color = tex2D(sampler_main, uv).xyz;
  ret = color * 0.95;
}

[comp_shader]
shader_body {
  ret = tex2D(sampler_main, uv).xyz;
}
`;
    const diagnostics = computeAstDiagnostics(sourceWithShader);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBe(0);
  });

  test('does not report unmatched parenthesis errors for inline smileys or strings', () => {
    const source = `
title="My Cool Preset (Remix)"
zoom=1.0 // check this :)
decay=0.95 // (note: smooth)
per_frame_1=rot = rot + 0.01;
`;
    const diagnostics = computeAstDiagnostics(source);
    const parenErrors = diagnostics.filter(
      (d) =>
        d.code === 'unmatched_closing_paren' || d.code === 'unclosed_paren',
    );
    expect(parenErrors.length).toBe(0);
  });

  test('correctly splits and parses multi-statement equation lines with nested parentheses', () => {
    const source = `
per_frame_1=q1 = if(above(bass, 1.2), 1, 0); rot = rot + q1 * 0.05;
`;
    const diagnostics = computeAstDiagnostics(source);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBe(0);
  });
});

describe('Code Editing Tooling Hardening: Agent Bridge postMessage dispatch', () => {
  test('handles toil:apply_source and toil:set_fields messages', async () => {
    let appliedSource: string | null = null;
    let appliedFields: Record<string, number | string> | null = null;

    const cleanup = initAgentBridge({
      applyEditorSource: async (src) => {
        appliedSource = src;
        return {
          presetId: 'test',
          title: 'Test',
          dirty: false,
          errorCount: 0,
          warningCount: 0,
          diagnostics: [],
          renderingFallback: false,
          renderedTitle: 'Test',
          sourceLength: src.length,
        };
      },
      applyEditorFields: async (fields) => {
        appliedFields = fields;
        return {
          presetId: 'test',
          title: 'Test',
          dirty: false,
          errorCount: 0,
          warningCount: 0,
          diagnostics: [],
          renderingFallback: false,
          renderedTitle: 'Test',
          sourceLength: 100,
        };
      },
    });

    window.postMessage({ type: 'toil:apply_source', source: 'zoom=1.5' }, '*');
    window.postMessage({ type: 'toil:set_fields', fields: { warp: 0.8 } }, '*');

    // Yield for event dispatch
    await new Promise((r) => setTimeout(r, 20));

    expect(appliedSource as unknown as string).toBe('zoom=1.5');
    expect(appliedFields as unknown as Record<string, number>).toEqual({
      warp: 0.8,
    });

    cleanup();
  });
});
