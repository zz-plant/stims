/**
 * Block-aware source model — a `.milk` file as contiguous segments of
 * equation/preamble lines and `[warp_shader]` / `[comp_shader]` blocks.
 *
 * The line-level syntax tree (preset-syntax.ts) classifies every line but
 * leaves block structure implicit: a shader block is a run of lines whose
 * *section* is `warp_shader` or `comp_shader`, opened by the header line
 * itself and closed by the next `[section]` header of any kind — the parser
 * classifies any line that is only a `[...]` group as a header, even one
 * that looks like shader code. Blank lines, `//` comments and `#define`
 * directives inside the block keep the shader section and therefore stay in
 * the block, exactly as `extractShaderSource` reads them.
 *
 * Segments partition the source: every line belongs to exactly one segment,
 * each carries the exact bytes of its lines (terminators included), and
 * `printMilkdropPresetSegments` gives the source back byte for byte. The
 * editor uses the line bounds to map shader-block edits and diagnostics
 * onto whole-document coordinates.
 *
 * MilkDrop 2's `warp_1=` / `comp_1=` assignment spelling of shader text is
 * *not* a section block; those lines stay in equation segments, matching the
 * parser, which reads them as assignments.
 */

import { isShaderSection, parsePresetSyntax } from './preset-syntax.ts';

export type MilkdropPresetSegment =
  | {
      /** Preamble, `key=value` fields, comments, and non-shader sections. */
      kind: 'equations';
      /** 1-based line number of the first line, inclusive. */
      startLine: number;
      /** 1-based line number of the last line, inclusive. */
      endLine: number;
      /** The segment's exact bytes, line terminators included. */
      text: string;
    }
  | {
      /** A `[warp_shader]` or `[comp_shader]` block, header line included. */
      kind: 'shader';
      stage: 'warp' | 'comp';
      startLine: number;
      endLine: number;
      text: string;
    };

/** The stage a shader section's lines belong to, or null outside one. */
function stageOfSection(section: string | null): 'warp' | 'comp' | null {
  if (!isShaderSection(section)) return null;
  return section === 'warp_shader' ? 'warp' : 'comp';
}

/**
 * Splits a preset source into contiguous segments. The result partitions
 * every line of the source in order; printing the segments back yields the
 * source byte for byte.
 */
export function splitMilkdropPresetSegments(
  source: string,
): MilkdropPresetSegment[] {
  const segments: MilkdropPresetSegment[] = [];
  let current: MilkdropPresetSegment | null = null;

  for (const line of parsePresetSyntax(source).lines) {
    // A source that ends with a terminator splits into one more element
    // than it has lines: the phantom carries no text and no terminator, so
    // it contributes no bytes and owns no line number.
    if (line.text === '' && line.eol === '') {
      continue;
    }
    const stage = stageOfSection(line.section);
    const continuesBlock =
      current !== null &&
      (current.kind === 'shader'
        ? stage !== null && current.stage === stage
        : stage === null);
    if (!continuesBlock) {
      if (current !== null) {
        segments.push(current);
      }
      current =
        stage !== null
          ? {
              kind: 'shader',
              stage,
              startLine: line.number,
              endLine: line.number,
              text: '',
            }
          : {
              kind: 'equations',
              startLine: line.number,
              endLine: line.number,
              text: '',
            };
    }
    if (current !== null) {
      current.endLine = line.number;
      current.text += line.text + line.eol;
    }
  }
  if (current !== null) {
    segments.push(current);
  }
  return segments;
}

/**
 * Reassembles segments into source. The inverse of
 * `splitMilkdropPresetSegments`: for any source,
 * `printMilkdropPresetSegments(splitMilkdropPresetSegments(source))`
 * equals `source` exactly, including line terminators and their absence on
 * the final line.
 */
export function printMilkdropPresetSegments(
  segments: readonly MilkdropPresetSegment[],
): string {
  let out = '';
  for (const segment of segments) {
    out += segment.text;
  }
  return out;
}

/**
 * The first `[warp_shader]` / `[comp_shader]` segment of the source, or null
 * when the stage has no block. A source that re-opens the same section keeps
 * its later blocks; callers that need them all read the split directly.
 */
export function findMilkdropShaderSegment(
  source: string,
  stage: 'warp' | 'comp',
): MilkdropPresetSegment | null {
  for (const segment of splitMilkdropPresetSegments(source)) {
    if (segment.kind === 'shader' && segment.stage === stage) {
      return segment;
    }
  }
  return null;
}
