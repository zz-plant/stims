/**
 * Variable index for the editor's "Jump to variable" popover (Cmd/Ctrl+J).
 *
 * Scrubbing a number is instant once you're looking at the line — finding
 * "the line that controls this" in a few hundred lines of per-frame
 * equations was the editor's dominant remaining time sink. This module is
 * the pure half: scan the .milk source for assignment targets, rank them,
 * filter them, and pick the next occurrence to visit. The popover UI in
 * editor-panel.ts owns the DOM.
 */

export interface VariableOccurrence {
  /** 1-based line number, matching CodeMirror's doc.line(). */
  line: number;
  /** 0-based column of the variable name within the line. */
  column: number;
}

export interface AssignedVariable {
  name: string;
  occurrences: VariableOccurrence[];
}

/**
 * Line keys of the .milk format (per_frame_1=, per_pixel_2=,
 * wavecode_0_per_point1=, …) look like assignments but are structure, not
 * state — jumping to "per_frame_12" helps nobody.
 */
const LINE_KEY_PATTERN =
  /^(?:per_(?:frame|pixel|point)(?:_init)?_?\d*|(?:wave|shape)(?:code)?_\d+_\w*|warp(?:_\d+)?|comp(?:_\d+)?)$/i;

/**
 * An identifier immediately followed by `=` that is not a comparison
 * (`==`, `<=`, `>=`, `!=`). The char before the identifier must not make it
 * a property/suffix of something else.
 */
const ASSIGNMENT_PATTERN = /(^|[^\w.])([a-zA-Z_]\w*)\s*=(?![=])/g;

/**
 * Scan source text for assignment targets. Occurrences are recorded in
 * document order; variables are returned most-assigned first (the ones a
 * preset drives hardest are usually the ones being hunted), ties broken
 * alphabetically.
 */
export function scanAssignedVariables(source: string): AssignedVariable[] {
  const byName = new Map<string, VariableOccurrence[]>();
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const lineText = lines[i];
    // Comments: `//` to end of line is dead text in .milk expressions.
    const commentStart = lineText.indexOf('//');
    const scannable =
      commentStart === -1 ? lineText : lineText.slice(0, commentStart);
    ASSIGNMENT_PATTERN.lastIndex = 0;
    let match = ASSIGNMENT_PATTERN.exec(scannable);
    while (match !== null) {
      const name = match[2];
      if (!LINE_KEY_PATTERN.test(name)) {
        const column = match.index + match[1].length;
        const list = byName.get(name);
        const occurrence = { line: i + 1, column };
        if (list) {
          list.push(occurrence);
        } else {
          byName.set(name, [occurrence]);
        }
      }
      // Resume right after the identifier so `a=b=c` finds both a and b.
      ASSIGNMENT_PATTERN.lastIndex =
        match.index + match[1].length + name.length;
      match = ASSIGNMENT_PATTERN.exec(scannable);
    }
  }
  return [...byName.entries()]
    .map(([name, occurrences]) => ({ name, occurrences }))
    .sort(
      (a, b) =>
        b.occurrences.length - a.occurrences.length ||
        a.name.localeCompare(b.name),
    );
}

/**
 * Case-insensitive filter: prefix matches rank first, then substring, then
 * subsequence — within each tier the scan order (most-assigned first) holds.
 */
export function filterVariables(
  variables: AssignedVariable[],
  query: string,
): AssignedVariable[] {
  const q = query.trim().toLowerCase();
  if (!q) return variables;
  const tiers: AssignedVariable[][] = [[], [], []];
  for (const variable of variables) {
    const name = variable.name.toLowerCase();
    if (name.startsWith(q)) {
      tiers[0].push(variable);
    } else if (name.includes(q)) {
      tiers[1].push(variable);
    } else {
      let qi = 0;
      for (let i = 0; i < name.length && qi < q.length; i += 1) {
        if (name[i] === q[qi]) qi += 1;
      }
      if (qi === q.length) tiers[2].push(variable);
    }
  }
  return tiers.flat();
}

/**
 * The occurrence strictly after the cursor, wrapping — so repeated jumps
 * to the same variable cycle through every line that assigns it.
 */
export function nextOccurrence(
  occurrences: VariableOccurrence[],
  cursorLine: number,
  cursorColumn: number,
): VariableOccurrence | null {
  if (occurrences.length === 0) return null;
  for (const occurrence of occurrences) {
    if (
      occurrence.line > cursorLine ||
      (occurrence.line === cursorLine && occurrence.column > cursorColumn)
    ) {
      return occurrence;
    }
  }
  return occurrences[0];
}
