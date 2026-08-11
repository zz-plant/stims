// Line diff for AI-assisted edit previews: small enough to render inline in
// the editor panel, faithful enough that "Apply" holds no surprises.

export type SourceDiffLine = {
  kind: 'context' | 'add' | 'del' | 'gap';
  text: string;
};

// Preset sources are a few hundred lines; beyond this the quadratic LCS is
// not worth it and the preview degrades to a whole-file replacement notice.
const MAX_DIFF_LINES = 2000;
const CONTEXT_LINES = 2;

export function computeSourceDiff(
  before: string,
  after: string,
): SourceDiffLine[] {
  if (before === after) {
    return [];
  }
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return [
      { kind: 'gap', text: `Replaces all ${a.length} lines with ${b.length} new lines` },
    ];
  }

  // Longest-common-subsequence table over lines.
  const rows = a.length;
  const cols = b.length;
  const lcs: Uint32Array[] = [];
  for (let i = 0; i <= rows; i += 1) {
    lcs.push(new Uint32Array(cols + 1));
  }
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const raw: SourceDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (a[i] === b[j]) {
      raw.push({ kind: 'context', text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      raw.push({ kind: 'del', text: a[i] });
      i += 1;
    } else {
      raw.push({ kind: 'add', text: b[j] });
      j += 1;
    }
  }
  while (i < rows) {
    raw.push({ kind: 'del', text: a[i] });
    i += 1;
  }
  while (j < cols) {
    raw.push({ kind: 'add', text: b[j] });
    j += 1;
  }

  return collapseContext(raw);
}

// Keep CONTEXT_LINES of unchanged code around each change; fold longer
// unchanged runs into a single "N unchanged lines" marker.
function collapseContext(lines: SourceDiffLine[]): SourceDiffLine[] {
  const out: SourceDiffLine[] = [];
  let run: SourceDiffLine[] = [];

  const flushRun = (isLast: boolean) => {
    const keepHead = out.length > 0 ? CONTEXT_LINES : 0;
    const keepTail = isLast ? 0 : CONTEXT_LINES;
    if (run.length <= keepHead + keepTail + 1) {
      out.push(...run);
    } else {
      out.push(...run.slice(0, keepHead));
      out.push({
        kind: 'gap',
        text: `${run.length - keepHead - keepTail} unchanged lines`,
      });
      if (keepTail > 0) {
        out.push(...run.slice(run.length - keepTail));
      }
    }
    run = [];
  };

  for (const line of lines) {
    if (line.kind === 'context') {
      run.push(line);
    } else {
      flushRun(false);
      out.push(line);
    }
  }
  flushRun(true);
  return out;
}
