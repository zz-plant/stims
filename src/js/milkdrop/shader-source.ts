/**
 * Shader source as the author wrote it — comments, braces, `shader_body`,
 * helper functions, indentation — recovered from the preset text.
 *
 * The compiler's `shaderText` is a normalised form for translation: comments
 * stripped, `{`/`}`/`shader_body` lines dropped, every line joined with a
 * space. That is fine for rendering and useless for editing: formatting from
 * it deleted the comments of every commented shader in the corpus, flattened
 * each shader onto one line, and left helper functions without their braces —
 * text MilkDrop 2 then refuses to compile.
 *
 * Both spellings are read: MilkDrop 2's `warp_1=\`…` lines (in line order,
 * one leading backtick removed) and Stims' `[warp_shader]` section (every line
 * up to the next `[section]` header, the same boundary the parser uses).
 */
import { isShaderSection, parsePresetSyntax } from './preset-syntax.ts';

export type MilkdropShaderSource = {
  warp: string | null;
  comp: string | null;
};

type Stage = 'warp' | 'comp';

const numberedKeyPattern = /^(warp|comp)_\d+$/iu;
const namedKeyPattern =
  /^(warp_shader|comp_shader|warp_code|comp_code|shader_text)$/iu;

function stageForName(name: string): Stage {
  return name.toLowerCase().startsWith('warp') ? 'warp' : 'comp';
}

function finish(lines: string[]): string | null {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start]?.trim()) start += 1;
  while (end > start && !lines[end - 1]?.trim()) end -= 1;
  return end > start ? lines.slice(start, end).join('\n') : null;
}

export function extractShaderSource(source: string): MilkdropShaderSource {
  const collected: Record<Stage, string[]> = { warp: [], comp: [] };

  for (const line of parsePresetSyntax(source).lines) {
    if (line.kind === 'section') {
      continue;
    }
    // Inside a shader section every line is kept, comments and blanks too.
    if (isShaderSection(line.section)) {
      collected[stageForName(line.section as string)].push(line.text.trimEnd());
      continue;
    }
    const key = line.kind === 'assignment' ? (line.key ?? '') : '';
    if (numberedKeyPattern.test(key) || namedKeyPattern.test(key)) {
      collected[stageForName(key)].push(
        (line.rawValue ?? '').replace(/^`/u, '').trimEnd(),
      );
    }
  }

  return { warp: finish(collected.warp), comp: finish(collected.comp) };
}

/**
 * MilkDrop 2 splices its own header in at `shader_body`, so a shader written
 * without one (Stims accepts a bare list of statements) is wrapped for export.
 */
export function ensureShaderBody(text: string): string {
  if (/\bshader_body\b/u.test(text)) {
    return text;
  }
  return [
    'shader_body',
    '{',
    ...text.split('\n').map((l) => `  ${l}`),
    '}',
  ].join('\n');
}
