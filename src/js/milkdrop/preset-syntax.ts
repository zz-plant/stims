/**
 * The preset's concrete syntax: every line of a `.milk` file, classified,
 * with nothing thrown away.
 *
 * A preset is line-structured — `key=value` assignments, `[section]`
 * headers, `//` comments, shader text — and four places used to read that
 * structure with their own scanner: the preset parser, the shader-source
 * recovery for Format and Export, the editor's knob/MIDI text edits, and the
 * editor's inline diagnostics. They disagreed at the edges. The knob scanner,
 * for one, treated everything after the first shader header as shader text,
 * so a field in a later `[preset00]` block — which the compiler reads and
 * renders from — was invisible to knobs, and a knob turn appended a second
 * assignment that the compiler's last-wins rule then ignored.
 *
 * Each line keeps its exact text and terminator, so `printPresetSyntax`
 * returns the source byte for byte; everything else is a view over the
 * lines. Expressions inside a line are parsed later, by the compiler.
 * Pure, with no imports: the compiler worker loads it.
 */

export type PresetSyntaxKind =
  /** Empty or whitespace only. */
  | 'blank'
  /** `//` anywhere; `#` or `;` outside a shader section. */
  | 'comment'
  /** `[name]`; `section` is the one it opens. */
  | 'section'
  /** `key=value` outside a shader section. `key` may be empty (`=5`). */
  | 'assignment'
  /** Any other line inside `[warp_shader]` / `[comp_shader]`. */
  | 'shader'
  /** Outside a shader section with no `=`: MilkDrop ignores it. */
  | 'text';

export type PresetSyntaxLine = {
  /** 1-based line number. */
  number: number;
  /** The line exactly as written, without its terminator. */
  text: string;
  /** The terminator that followed it: `\n`, `\r\n`, or `''` on the last line. */
  eol: string;
  kind: PresetSyntaxKind;
  /**
   * The section the line sits in, lower-cased (`null` before the first
   * header, `''` after an empty `[]`). A header carries the one it opens.
   */
  section: string | null;
  /** Assignment: the key, trimmed. */
  key?: string;
  /**
   * Assignment: the value after the first `=`, trimmed, trailing comment
   * removed. Shader: the line's code, trimmed, trailing comment removed.
   */
  value?: string;
  /** Assignment: everything after the first `=`, verbatim. */
  rawValue?: string;
  /** Assignment or shader: the trailing `//` comment, trimmed. */
  comment?: string;
};

export type PresetSyntaxTree = { lines: PresetSyntaxLine[] };

/** Lines longer than this are classified by their first 100,000 chars. */
export const MAX_SYNTAX_LINE_CHARS = 100_000;

export function isShaderSection(section: string | null): boolean {
  return section === 'warp_shader' || section === 'comp_shader';
}

/** Splits a trailing `//` comment off a line, ignoring `//` inside quotes. */
export function splitInlineComment(line: string): {
  code: string;
  comment: string;
} {
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
      return {
        code: line.slice(0, index).trimEnd(),
        comment: line.slice(index).trim(),
      };
    }
  }

  return { code: line, comment: '' };
}

function classify(
  text: string,
  section: string | null,
): Omit<PresetSyntaxLine, 'number' | 'text' | 'eol'> {
  const line =
    text.length > MAX_SYNTAX_LINE_CHARS
      ? text.slice(0, MAX_SYNTAX_LINE_CHARS)
      : text;
  const trimmed = line.trim();
  if (!trimmed) {
    return { kind: 'blank', section };
  }

  // `#` and `;` start a comment in the key=value body, but inside a shader
  // section they are shader text — a preprocessor directive (`#define`,
  // `#if`) or an empty statement — that Format writes back out as a bare
  // line. Skipping a directive silently deleted the whole section whenever
  // the shader began with one.
  const inShader = isShaderSection(section);
  if (
    trimmed.startsWith('//') ||
    ((trimmed.startsWith('#') || trimmed.startsWith(';')) && !inShader)
  ) {
    return { kind: 'comment', section };
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return {
      kind: 'section',
      section: trimmed.slice(1, -1).trim().toLowerCase(),
    };
  }

  const { code, comment } = splitInlineComment(line);
  const withoutComment = code.trim();
  if (!withoutComment) {
    return { kind: 'comment', section };
  }
  const commentPart = comment ? { comment } : {};

  if (inShader) {
    return { kind: 'shader', section, value: withoutComment, ...commentPart };
  }

  const equalsIndex = withoutComment.indexOf('=');
  if (equalsIndex < 0) {
    return { kind: 'text', section, ...commentPart };
  }
  return {
    kind: 'assignment',
    section,
    key: withoutComment.slice(0, equalsIndex).trim(),
    value: withoutComment.slice(equalsIndex + 1).trim(),
    rawValue: text.slice(text.indexOf('=') + 1),
    ...commentPart,
  };
}

export function parsePresetSyntax(source: string): PresetSyntaxTree {
  const texts = source.split(/\r?\n/u);
  const lines: PresetSyntaxLine[] = new Array(texts.length);
  let section: string | null = null;
  let offset = 0;
  for (let index = 0; index < texts.length; index += 1) {
    const text = texts[index] as string;
    offset += text.length;
    // A split line never ends in `\r` before its `\n` (the pattern takes it),
    // so the terminator is whatever sits at the offset.
    const eol =
      index === texts.length - 1
        ? ''
        : source.charCodeAt(offset) === 13
          ? '\r\n'
          : '\n';
    offset += eol.length;
    const line = classify(text, section) as PresetSyntaxLine;
    line.number = index + 1;
    line.text = text;
    line.eol = eol;
    if (line.kind === 'section') {
      section = line.section;
    }
    lines[index] = line;
  }
  return { lines };
}

export function printPresetSyntax(tree: PresetSyntaxTree): string {
  let out = '';
  for (const line of tree.lines) {
    out += line.text + line.eol;
  }
  return out;
}

/**
 * Assignment lines the compiler reads as preset fields: outside shader
 * sections, with a key.
 */
export function fieldAssignments(tree: PresetSyntaxTree): PresetSyntaxLine[] {
  return tree.lines.filter(
    (line) => line.kind === 'assignment' && Boolean(line.key),
  );
}
