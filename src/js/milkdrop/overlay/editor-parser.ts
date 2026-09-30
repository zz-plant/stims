/**
 * Editor source-diagnostic parsing, split out of editor-panel.ts so the
 * MilkDrop parser checks stay unit-testable without a DOM shell.
 */
import {
  parseMilkdropExpression,
  parseMilkdropStatement,
  splitMilkdropStatements,
} from '../expression';
import { parseMilkdropPreset } from '../preset-parser';
import { parsePresetSyntax } from '../preset-syntax.ts';
import type { MilkdropDiagnostic } from '../types';

export function computeAstDiagnostics(source: string): MilkdropDiagnostic[] {
  const diagnostics: MilkdropDiagnostic[] = [];

  const presetResult = parseMilkdropPreset(source);
  diagnostics.push(...presetResult.diagnostics);

  // Blank, comment and header lines, and shader text, have nothing to check.
  for (const line of parsePresetSyntax(source).lines) {
    if (line.kind !== 'assignment' && line.kind !== 'text') {
      continue;
    }
    const lineNumber = line.number;
    const trimmed = line.text.trim();

    // Strip inline comments and string literals so comments like "// smile :)" or
    // strings like `title = "Part (1)"` do not trigger false parenthesis errors.
    let strippedCode = '';
    let inString: '"' | "'" | null = null;
    for (let i = 0; i < trimmed.length; i += 1) {
      const char = trimmed[i];
      if (inString) {
        if (char === inString) inString = null;
        continue;
      }
      if (char === '"' || char === "'") {
        inString = char;
        continue;
      }
      if (char === '/' && trimmed[i + 1] === '/') {
        break;
      }
      if (char === '#') {
        break;
      }
      strippedCode += char;
    }

    let parenDepth = 0;
    for (let i = 0; i < strippedCode.length; i += 1) {
      const char = strippedCode[i];
      if (char === '(') {
        parenDepth += 1;
      } else if (char === ')') {
        parenDepth -= 1;
        if (parenDepth < 0) {
          diagnostics.push({
            severity: 'error',
            code: 'unmatched_closing_paren',
            line: lineNumber,
            message: `Unmatched closing parenthesis ')' at line ${lineNumber}.`,
          });
          parenDepth = 0;
        }
      }
    }
    if (parenDepth > 0) {
      diagnostics.push({
        severity: 'error',
        code: 'unclosed_paren',
        line: lineNumber,
        message: `Unclosed parenthesis '(' at line ${lineNumber}.`,
      });
    }

    const equalsIdx = strippedCode.indexOf('=');
    if (equalsIdx > 0) {
      const key = strippedCode.slice(0, equalsIdx).trim().toLowerCase();
      const val = strippedCode.slice(equalsIdx + 1).trim();

      const isEquationKey =
        key.startsWith('per_frame') ||
        key.startsWith('per_pixel') ||
        key.startsWith('wave_') ||
        key.startsWith('shape_') ||
        key === 'warp' ||
        key === 'comp';

      if (isEquationKey && val) {
        const statements = splitMilkdropStatements(val);
        statements.forEach((stmt) => {
          const s = stmt.trim();
          if (!s) return;
          if (s.includes('=')) {
            const res = parseMilkdropStatement(s, lineNumber);
            diagnostics.push(...res.diagnostics);
          } else {
            const res = parseMilkdropExpression(s, lineNumber);
            diagnostics.push(...res.diagnostics);
          }
        });
      } else if (val && /^[0-9A-Za-z_+\-*/\s().]+$/u.test(val)) {
        const res = parseMilkdropExpression(val, lineNumber);
        diagnostics.push(...res.diagnostics);
      }
    }
  }

  return mergeDiagnostics(diagnostics, []);
}

export function mergeDiagnostics(
  primary: MilkdropDiagnostic[],
  secondary: MilkdropDiagnostic[],
): MilkdropDiagnostic[] {
  const map = new Map<string, MilkdropDiagnostic>();
  [...primary, ...secondary].forEach((diag) => {
    const key = `${diag.line ?? 0}:${diag.code ?? ''}:${diag.message}`;
    if (!map.has(key)) {
      map.set(key, diag);
    }
  });
  return Array.from(map.values());
}
