/**
 * Where and how a .milk source sets a control, so a viewer who asks "what
 * moves this?" can be taken to the line, and offered a slider only where
 * one can work (the canvas inspector).
 */

const escapeName = (name: string) =>
  name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `section_N=code` lines: the section name and the code after the `=`. */
function sectionLines(source: string) {
  return source.split(/\r?\n/).map((line, index) => {
    const match = /^([a-z_]+?)_?\d*\s*=(.*)$/i.exec(line.trim());
    return {
      number: index + 1,
      text: line.trim(),
      section: match ? match[1].toLowerCase() : null,
      code: match ? match[2] : '',
    };
  });
}

/** The right-hand sides of every `control = …` statement in `code`. */
function assignmentsOf(code: string, control: string): string[] {
  const target = new RegExp(`^\\s*${escapeName(control)}\\s*=(?!=)(.*)$`, 'i');
  const out: string[] = [];
  for (const statement of code.split(';')) {
    const match = target.exec(
      statement.replace(/^.*[(,]\s*(?=\w+\s*=[^=])/, ''),
    );
    if (match) out.push(match[1]);
  }
  return out;
}

/**
 * The 1-based line that assigns `control`, looking where it matters most:
 * per-pixel code, then per-frame code, then the field's own `name=value`
 * line. Null when the preset never sets it.
 */
export function findControlLine(
  source: string,
  control: string,
): number | null {
  const lines = sectionLines(source);
  for (const section of ['per_pixel', 'per_frame']) {
    const line = lines.find(
      (entry) =>
        entry.section === section &&
        assignmentsOf(entry.code, control).length > 0,
    );
    if (line) return line.number;
  }
  const field = new RegExp(`^${escapeName(control)}\\s*=`, 'i');
  return lines.find((entry) => field.test(entry.text))?.number ?? null;
}

/**
 * Whether changing the preset's base value of `control` reaches the
 * picture: no per-frame statement sets it (that would overwrite the base
 * every frame), and every per-pixel statement that sets it reads it back
 * (`rot = rot + …`, not `rot = …` from scratch). Conservative: a statement
 * it cannot read as either counts as overwriting.
 */
export function baseReachesControl(source: string, control: string): boolean {
  const reads = new RegExp(`(?<![\\w.])${escapeName(control)}(?![\\w.])`, 'i');
  for (const line of sectionLines(source)) {
    if (line.section !== 'per_frame' && line.section !== 'per_pixel') continue;
    for (const rhs of assignmentsOf(line.code, control)) {
      if (line.section === 'per_frame' || !reads.test(rhs)) return false;
    }
  }
  return true;
}
