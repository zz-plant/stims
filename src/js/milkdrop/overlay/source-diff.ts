// Line diff for AI-assisted edit previews: small enough to render inline in
// the editor panel, faithful enough that "Apply" holds no surprises.

export type SourceDiffLine = {
  kind: 'context' | 'add' | 'del' | 'gap';
  text: string;
};

export type SourceDiffStats = {
  oldLineCount: number;
  newLineCount: number;
  /** Largest pair of LCS rows allocated at once, measured in Uint32 cells. */
  maxWorkingCells: number;
  usedCoarseFallback: boolean;
};

export type SourceDiffOptions = {
  /** Test/diagnostic hook; it does not retain any of the diff's working data. */
  onStats?: (stats: SourceDiffStats) => void;
};

// Bound both CPU work and input storage. Above these limits a detailed preview
// is less useful than a prompt whole-document replacement warning.
const MAX_DIFF_LINES = 2000;
const MAX_DIFF_CHARACTERS = 2_000_000;
const CONTEXT_LINES = 2;

type Match = { oldIndex: number; newIndex: number };

export function computeSourceDiff(
  before: string,
  after: string,
  options: SourceDiffOptions = {},
): SourceDiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const stats: SourceDiffStats = {
    oldLineCount: a.length,
    newLineCount: b.length,
    maxWorkingCells: 0,
    usedCoarseFallback: false,
  };
  const finish = (diff: SourceDiffLine[]) => {
    options.onStats?.(stats);
    return diff;
  };

  if (before === after) {
    return finish([]);
  }
  if (
    a.length > MAX_DIFF_LINES ||
    b.length > MAX_DIFF_LINES ||
    before.length + after.length > MAX_DIFF_CHARACTERS
  ) {
    stats.usedCoarseFallback = true;
    return finish([
      {
        kind: 'gap',
        text: `Replaces all ${a.length} lines with ${b.length} new lines`,
      },
    ]);
  }

  // Hirschberg reconstruction retains only two LCS rows. Put the shorter
  // document on the row width so auxiliary memory is O(min(old, new)), rather
  // than retaining the previous oldLineCount * newLineCount matrix.
  let matches: Match[];
  if (b.length <= a.length) {
    matches = findLcsMatches(a, b, stats).map(([oldIndex, newIndex]) => ({
      oldIndex,
      newIndex,
    }));
  } else {
    matches = findLcsMatches(b, a, stats).map(([newIndex, oldIndex]) => ({
      oldIndex,
      newIndex,
    }));
  }

  const raw: SourceDiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  for (const match of matches) {
    while (oldIndex < match.oldIndex) {
      raw.push({ kind: 'del', text: a[oldIndex++] });
    }
    while (newIndex < match.newIndex) {
      raw.push({ kind: 'add', text: b[newIndex++] });
    }
    raw.push({ kind: 'context', text: a[oldIndex] });
    oldIndex += 1;
    newIndex += 1;
  }
  while (oldIndex < a.length) {
    raw.push({ kind: 'del', text: a[oldIndex++] });
  }
  while (newIndex < b.length) {
    raw.push({ kind: 'add', text: b[newIndex++] });
  }

  return finish(collapseContext(raw));
}

/** Returns ordered matching indexes using linear-space LCS reconstruction. */
function findLcsMatches(
  rows: string[],
  columns: string[],
  stats: SourceDiffStats,
  rowStart = 0,
  rowEnd = rows.length,
  columnStart = 0,
  columnEnd = columns.length,
): Array<[number, number]> {
  if (rowStart === rowEnd || columnStart === columnEnd) {
    return [];
  }
  if (rowEnd - rowStart === 1) {
    for (let column = columnStart; column < columnEnd; column += 1) {
      if (rows[rowStart] === columns[column]) {
        return [[rowStart, column]];
      }
    }
    return [];
  }

  const rowMiddle = Math.floor((rowStart + rowEnd) / 2);
  const columnMiddle = findSplitColumn(
    rows,
    columns,
    rowStart,
    rowMiddle,
    rowEnd,
    columnStart,
    columnEnd,
    stats,
  );
  return [
    ...findLcsMatches(
      rows,
      columns,
      stats,
      rowStart,
      rowMiddle,
      columnStart,
      columnMiddle,
    ),
    ...findLcsMatches(
      rows,
      columns,
      stats,
      rowMiddle,
      rowEnd,
      columnMiddle,
      columnEnd,
    ),
  ];
}

function findSplitColumn(
  rows: string[],
  columns: string[],
  rowStart: number,
  rowMiddle: number,
  rowEnd: number,
  columnStart: number,
  columnEnd: number,
  stats: SourceDiffStats,
): number {
  const width = columnEnd - columnStart;
  stats.maxWorkingCells = Math.max(stats.maxWorkingCells, 2 * (width + 1));
  const forward = lcsLengths(
    rows,
    columns,
    rowStart,
    rowMiddle,
    columnStart,
    columnEnd,
    false,
  );
  const backward = lcsLengths(
    rows,
    columns,
    rowMiddle,
    rowEnd,
    columnStart,
    columnEnd,
    true,
  );
  let split = 0;
  let best = -1;
  for (let offset = 0; offset <= width; offset += 1) {
    const length = forward[offset] + backward[width - offset];
    if (length > best) {
      best = length;
      split = offset;
    }
  }
  return columnStart + split;
}

function lcsLengths(
  rows: string[],
  columns: string[],
  rowStart: number,
  rowEnd: number,
  columnStart: number,
  columnEnd: number,
  reverse: boolean,
): Uint32Array {
  const width = columnEnd - columnStart;
  const lengths = new Uint32Array(width + 1);
  for (let rowOffset = 0; rowOffset < rowEnd - rowStart; rowOffset += 1) {
    const row = reverse ? rowEnd - rowOffset - 1 : rowStart + rowOffset;
    let diagonal = 0;
    for (let offset = 1; offset <= width; offset += 1) {
      const column = reverse ? columnEnd - offset : columnStart + offset - 1;
      const previousRowLength = lengths[offset];
      lengths[offset] =
        rows[row] === columns[column]
          ? diagonal + 1
          : Math.max(previousRowLength, lengths[offset - 1]);
      diagonal = previousRowLength;
    }
  }
  return lengths;
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
