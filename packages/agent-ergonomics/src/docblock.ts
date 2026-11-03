/**
 * Reads the file-level docblock that every script and module summary is
 * generated from: the `/** … *\/` block at the top of a file.
 *
 * One parser for every consumer. The script index (`help`), the module-docs
 * guard and the guardrails page each used to carry their own copy, and the
 * copies had drifted: the index looked for the opener within 30 lines, the
 * guards within 10, and one of them dropped text written on the opener or
 * closer line. Three definitions of "documented" is how a file passes one
 * guard and fails another for the same comment.
 *
 * The opener must sit near the top of the file (`openerWithin` lines), or a
 * docblock on some interior constant would be read as the file's summary. The
 * closer may be anywhere: the best-documented files have the longest headers,
 * and bounding the whole block silently dropped exactly those.
 */

export type Docblock = {
  /**
   * The first paragraph, joined into one line with single spaces. It stops at
   * the first blank line or the first `@tag` line, whichever comes first.
   */
  summary: string;
  /** Everything after the summary paragraph, line breaks kept, trimmed. */
  rest: string;
  /** The block's lines with the comment syntax stripped, in order. */
  body: string[];
};

export type ParseDocblockOptions = {
  /** How many lines from the top of the file the opener may appear in. */
  openerWithin?: number;
};

const OPENER = /^\s*\/\*\*\s?/u;
const CLOSER = /\*\/.*$/u;
const LEADING_STAR = /^\s*\*\s?/u;

/** Parses the file-level docblock of `text`, or returns null when it has none. */
export function parseDocblock(
  text: string,
  { openerWithin = 10 }: ParseDocblockOptions = {},
): Docblock | null {
  const lines = text.split(/\r?\n/u);
  const start = lines
    .slice(0, openerWithin)
    .findIndex((line) => line.trimStart().startsWith('/**'));
  if (start === -1) return null;

  const body: string[] = [];
  for (const raw of lines.slice(start)) {
    const closes = raw.includes('*/');
    const line = raw
      .replace(OPENER, '')
      .replace(CLOSER, '')
      .replace(LEADING_STAR, '')
      .trimEnd();
    // A bare opener or closer line carries no text; dropping it keeps a block
    // written as `/**\n * text\n */` from starting with a blank line.
    const bare = (raw.trimStart().startsWith('/**') || closes) && line === '';
    if (!bare) body.push(line);
    if (closes) break;
  }

  let index = 0;
  while (index < body.length && (body[index] ?? '').trim() === '') index += 1;

  const paragraph: string[] = [];
  for (; index < body.length; index += 1) {
    const line = (body[index] ?? '').trim();
    if (line.startsWith('@') || line === '') break;
    paragraph.push(line);
  }
  const summary = paragraph.join(' ').replace(/\s+/gu, ' ').trim();
  const rest = body.slice(index).join('\n').replace(/^\n+/u, '').trim();
  return { summary, rest, body };
}
