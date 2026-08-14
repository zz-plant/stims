import type {
  MilkdropDiagnostic,
  MilkdropPresetAST,
  MilkdropPresetField,
} from './types';

function stripInlineComment(line: string) {
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < line.length; index += 1) {
    const current = line[index];
    const next = line[index + 1];

    if (quote) {
      // Only the matching quote character closes the string — a stray
      // apostrophe inside a double-quoted title (or vice versa) is just
      // literal content, not a toggle. Treating every quote char as a
      // toggle regardless of kind let mismatched quotes flip `quote` to
      // null mid-string, so a real "//" later on the line either failed
      // to strip (comment leaked into the field value) or got stripped
      // too early (truncating quoted content that legitimately contains
      // "//").
      if (current === quote) {
        quote = null;
      }
      continue;
    }

    if (current === '"' || current === "'") {
      quote = current;
      continue;
    }

    if (current === '/' && next === '/') {
      return line.slice(0, index).trimEnd();
    }
  }

  return line;
}

const MAX_SOURCE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_LINE_CHARS = 100_000;
const MAX_PRESET_FIELDS = 10_000;

export function parseMilkdropPreset(source: string): {
  ast: MilkdropPresetAST;
  diagnostics: MilkdropDiagnostic[];
} {
  const diagnostics: MilkdropDiagnostic[] = [];
  const fields: MilkdropPresetField[] = [];
  const sections: string[] = [];
  let currentSection: string | null = null;

  if (source.length > MAX_SOURCE_BYTES) {
    diagnostics.push({
      severity: 'error',
      category: 'parse',
      code: 'preset_source_too_large',
      line: 1,
      message: `Preset source exceeds maximum safe size of 5MB.`,
    });
    return { ast: { source: '', fields: [], sections: [] }, diagnostics };
  }

  const lines = source.split(/\r?\n/u);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (fields.length >= MAX_PRESET_FIELDS) {
      diagnostics.push({
        severity: 'warning',
        category: 'parse',
        code: 'preset_max_fields_exceeded',
        line: lineIndex + 1,
        message: `Preset field count exceeded maximum limit of 10,000 fields.`,
      });
      break;
    }

    const rawLine = lines[lineIndex] ?? '';
    const line =
      rawLine.length > MAX_LINE_CHARS
        ? rawLine.slice(0, MAX_LINE_CHARS)
        : rawLine;
    const number = lineIndex + 1;
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith(';')
    ) {
      continue;
    }

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      currentSection = trimmed.slice(1, -1).trim().toLowerCase();
      if (currentSection) {
        sections.push(currentSection);
      }
      continue;
    }

    const withoutComments = stripInlineComment(line).trim();
    if (!withoutComments) {
      continue;
    }

    const equalsIndex = withoutComments.indexOf('=');
    if (equalsIndex < 0) {
      if (
        currentSection === 'warp_shader' ||
        currentSection === 'comp_shader'
      ) {
        fields.push({
          key: currentSection,
          rawValue: withoutComments,
          line: number,
          section: currentSection,
        });
        continue;
      }
      diagnostics.push({
        severity: 'warning',
        category: 'parse',
        code: 'preset_line_ignored',
        line: number,
        message: `Ignored line without an assignment: "${trimmed}".`,
      });
      continue;
    }

    const key =
      currentSection === 'warp_shader' || currentSection === 'comp_shader'
        ? currentSection
        : withoutComments.slice(0, equalsIndex).trim();
    const rawValue =
      currentSection === 'warp_shader' || currentSection === 'comp_shader'
        ? withoutComments
        : withoutComments.slice(equalsIndex + 1).trim();
    if (!key) {
      diagnostics.push({
        severity: 'warning',
        category: 'parse',
        code: 'preset_missing_key',
        line: number,
        message: 'Ignored assignment without a key.',
      });
      continue;
    }

    fields.push({
      key,
      rawValue,
      line: number,
      section: currentSection,
    });
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
