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

export function parseMilkdropPreset(source: string): {
  ast: MilkdropPresetAST;
  diagnostics: MilkdropDiagnostic[];
} {
  const diagnostics: MilkdropDiagnostic[] = [];
  const fields: MilkdropPresetField[] = [];
  const sections: string[] = [];
  let currentSection: string | null = null;

  const lines = source.split(/\r?\n/u);
  lines.forEach((line, lineIndex) => {
    const number = lineIndex + 1;
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith(';')
    ) {
      return;
    }

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      currentSection = trimmed.slice(1, -1).trim().toLowerCase();
      if (currentSection) {
        sections.push(currentSection);
      }
      return;
    }

    const withoutComments = stripInlineComment(line).trim();
    if (!withoutComments) {
      return;
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
        return;
      }
      diagnostics.push({
        severity: 'warning',
        category: 'parse',
        code: 'preset_line_ignored',
        line: number,
        message: `Ignored line without an assignment: "${trimmed}".`,
      });
      return;
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
      return;
    }

    fields.push({
      key,
      rawValue,
      line: number,
      section: currentSection,
    });
  });

  return {
    ast: {
      source,
      fields,
      sections,
    },
    diagnostics,
  };
}
