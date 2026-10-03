export interface SpinExample {
  before: string;
  after: string;
}

/** Append instead of replacing the author's equations; one click can undo
 * this exact edit without touching anything the visitor adds afterwards. */
export function addSpinExample(source: string): SpinExample {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  let last = 0;
  for (const match of source.matchAll(/^\s*per_frame_(\d+)\s*=/gimu)) {
    last = Math.max(last, Number(match[1]));
  }
  const separator = source.endsWith('\n') ? '' : newline;
  return {
    before: source,
    after: `${source}${separator}per_frame_${last + 1}=rot=rot+0.02;${newline}`,
  };
}

export function undoSpinExample(
  source: string,
  edit: SpinExample,
): string | null {
  return source === edit.after ? edit.before : null;
}
