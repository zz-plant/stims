import { MAX_SYNTAX_LINE_CHARS, parsePresetSyntax } from './preset-syntax.ts';
import type {
  MilkdropDiagnostic,
  MilkdropPresetAST,
  MilkdropPresetField,
} from './types';

const MAX_SOURCE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_PRESET_FIELDS = 10_000;

export function parseMilkdropPreset(source: string): {
  ast: MilkdropPresetAST;
  diagnostics: MilkdropDiagnostic[];
} {
  const safeSource = typeof source === 'string' ? source : '';
  const diagnostics: MilkdropDiagnostic[] = [];
  const fields: MilkdropPresetField[] = [];
  const sections: string[] = [];

  if (!safeSource) {
    return { ast: { source: '', fields: [], sections: [] }, diagnostics };
  }

  if (safeSource.length > MAX_SOURCE_BYTES) {
    diagnostics.push({
      severity: 'error',
      category: 'parse',
      code: 'preset_source_too_large',
      line: 1,
      message: `Preset source exceeds the maximum safe size of 5 MB.`,
    });
    return { ast: { source: '', fields: [], sections: [] }, diagnostics };
  }

  for (const line of parsePresetSyntax(safeSource).lines) {
    if (fields.length >= MAX_PRESET_FIELDS) {
      diagnostics.push({
        severity: 'warning',
        category: 'parse',
        code: 'preset_max_fields_exceeded',
        line: line.number,
        message: `Preset field count exceeded the limit of 10,000 fields.`,
      });
      break;
    }

    switch (line.kind) {
      case 'section':
        if (line.section) {
          sections.push(line.section);
        }
        break;
      case 'shader':
        fields.push({
          key: line.section as string,
          rawValue: line.value as string,
          line: line.number,
          section: line.section,
        });
        break;
      case 'text':
        diagnostics.push({
          severity: 'warning',
          category: 'parse',
          code: 'preset_line_ignored',
          line: line.number,
          message: `Ignored line without an assignment: "${line.text.slice(0, MAX_SYNTAX_LINE_CHARS).trim()}".`,
        });
        break;
      case 'assignment':
        if (!line.key) {
          diagnostics.push({
            severity: 'warning',
            category: 'parse',
            code: 'preset_missing_key',
            line: line.number,
            message: 'Ignored assignment without a key.',
          });
          break;
        }
        fields.push({
          key: line.key,
          rawValue: line.value as string,
          line: line.number,
          section: line.section,
          // Shader comments are recovered verbatim by shader-source.ts; this
          // carries the equation comments Format would otherwise delete.
          ...(line.comment ? { comment: line.comment } : {}),
        });
        break;
      default:
        break;
    }
  }

  return {
    ast: {
      source,
      fields,
      sections,
    },
    diagnostics,
  };
}
