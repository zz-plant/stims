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

    if (current === '"' || current === "'") {
      quote = quote === current ? null : current;
      continue;
    }

    if (!quote && current === '/' && next === '/') {
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
      diagnostics.push({
        severity: 'warning',
        code: 'preset_line_ignored',
        line: number,
        message: `Ignored line without an assignment: "${trimmed}".`,
      });
      return;
    }

    const key = withoutComments.slice(0, equalsIndex).trim();
    const rawValue = withoutComments.slice(equalsIndex + 1).trim();
    if (!key) {
      diagnostics.push({
        severity: 'warning',
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
