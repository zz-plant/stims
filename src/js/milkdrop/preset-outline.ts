/**
 * Table of contents for a `.milk` buffer.
 *
 * A preset is one flat text file, but the parts an author edits are distinct:
 * the per-frame and per-pixel equations, up to four custom waves and shapes
 * (each with settings and code), and the two shaders. Real presets run to
 * hundreds of lines, and MilkDrop 2 gave each part its own screen. This lists
 * the parts with their line ranges so the editor can jump to one.
 *
 * Labels use the file's own key names (`wave_0`, `shape_1`) rather than the
 * 1-based numbering some MilkDrop UIs show, so what the outline says is what
 * the buffer contains.
 */

export type OutlineKind =
  | 'settings'
  | 'init'
  | 'per-frame'
  | 'per-pixel'
  | 'wave'
  | 'shape'
  | 'warp-shader'
  | 'comp-shader';

export type OutlineEntry = {
  label: string;
  kind: OutlineKind;
  /** 1-based line of the first line belonging to this part. */
  firstLine: number;
  lastLine: number;
  /** How many lines of the buffer belong to this part. */
  lines: number;
};

type Classified = { label: string; kind: OutlineKind };

const SHADER_SECTIONS: Record<string, Classified> = {
  warp_shader: { label: 'Warp shader', kind: 'warp-shader' },
  comp_shader: { label: 'Composite shader', kind: 'comp-shader' },
};

const CODE_PART_LABEL: Record<string, string> = {
  init: 'init',
  per_frame: 'per-frame',
  per_point: 'per-point',
};

function classifyKey(key: string): Classified {
  // `init_N` is an older Stims spelling of `per_frame_init_N`.
  if (/^(?:per_frame_)?init_\d+$/u.test(key)) {
    return { label: 'Init (per_frame_init)', kind: 'init' };
  }
  if (/^per_frame_\d+$/u.test(key)) {
    return { label: 'Per-frame equations', kind: 'per-frame' };
  }
  if (/^per_pixel_\d+$/u.test(key)) {
    return { label: 'Per-pixel equations', kind: 'per-pixel' };
  }
  const code = /^(wave|shape)_(\d+)_(init|per_frame|per_point)\d*$/u.exec(key);
  if (code) {
    const [, which, index, part] = code;
    return {
      label: `${which}_${index} ${CODE_PART_LABEL[part as string]}`,
      kind: which as 'wave' | 'shape',
    };
  }
  const settings = /^(wavecode|shapecode)_(\d+)_/u.exec(key);
  if (settings) {
    const [, which, index] = settings;
    const kind = which === 'wavecode' ? 'wave' : 'shape';
    return { label: `${kind}_${index} settings`, kind };
  }
  if (/^warp_\d+$/u.test(key)) return SHADER_SECTIONS.warp_shader as Classified;
  if (/^comp_\d+$/u.test(key)) return SHADER_SECTIONS.comp_shader as Classified;
  return { label: 'Settings', kind: 'settings' };
}

export function buildPresetOutline(source: string): OutlineEntry[] {
  const parts = new Map<string, OutlineEntry>();
  let section: Classified | null = null;

  source.split(/\r?\n/u).forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = raw.trim();
    if (
      !line ||
      line.startsWith('//') ||
      line.startsWith(';') ||
      (line.startsWith('#') && !section)
    ) {
      return;
    }

    const header = /^\[\s*([a-z_0-9]+)\s*\]$/iu.exec(line);
    if (header) {
      section = SHADER_SECTIONS[(header[1] as string).toLowerCase()] ?? null;
      // `[preset00]` and other headers start no part of their own; a shader
      // header opens its part on the header line itself.
      if (!section) return;
      record(parts, section, lineNumber);
      return;
    }

    if (section) {
      record(parts, section, lineNumber);
      return;
    }

    const equals = line.indexOf('=');
    if (equals < 0) return;
    record(
      parts,
      classifyKey(line.slice(0, equals).trim().toLowerCase()),
      lineNumber,
    );
  });

  return [...parts.values()].sort((a, b) => a.firstLine - b.firstLine);
}

function record(
  parts: Map<string, OutlineEntry>,
  classified: Classified,
  lineNumber: number,
) {
  const existing = parts.get(classified.label);
  if (existing) {
    existing.lastLine = lineNumber;
    existing.lines += 1;
  } else {
    parts.set(classified.label, {
      ...classified,
      firstLine: lineNumber,
      lastLine: lineNumber,
      lines: 1,
    });
  }
}
