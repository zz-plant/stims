/**
 * The editor's Compat tab, as data: what about this preset will not run the
 * way its source says, on Stims, and where in the buffer it comes from.
 *
 * The compiler already computes all of this (`ir.compatibility.parity`), but
 * the editor reduced it to one "Simplified" flag with a single reason. An
 * author fixing a preset needs the whole list, worst first, each item pointing
 * at a line.
 *
 * This describes Stims only. It makes no claim about MilkDrop 2, projectM or
 * Butterchurn; the cross-engine matrix lives in docs/authoring/08-shipping.md.
 */
import { findMilkdropFieldLine } from './formatter.ts';
import type { MilkdropCompiledPreset } from './types.ts';

export type CompatSeverity = 'blocker' | 'approximation' | 'ignored' | 'note';

export type CompatItem = {
  severity: CompatSeverity;
  title: string;
  detail: string;
  /** 1-based line in the buffer, or null when the source has no such line. */
  line: number | null;
};

export type CompatEngineStatus = {
  engine: 'WebGL' | 'WebGPU';
  status: 'supported' | 'partial' | 'unsupported';
};

export type CompatChecklist = {
  fidelity: 'exact' | 'near-exact' | 'partial' | 'fallback';
  headline: string;
  engines: CompatEngineStatus[];
  items: CompatItem[];
};

const SEVERITY_ORDER: Record<CompatSeverity, number> = {
  blocker: 0,
  approximation: 1,
  ignored: 2,
  note: 3,
};

const HEADLINES = {
  exact: 'Runs exactly as the source says.',
  'near-exact': 'Runs as the source says, within rounding.',
  partial: 'Runs, but some things differ from the source.',
  fallback: 'Runs on a simplified fallback.',
} as const;

function stripComment(line: string): string {
  const cut = line.indexOf('//');
  return cut < 0 ? line : line.slice(0, cut);
}

/** First line that uses `name` as a word, outside comments. */
function findWordLine(source: string, name: string): number | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const pattern = new RegExp(`(?<![\\w.])${escaped}(?![\\w])`, 'u');
  const lines = source.split(/\r?\n/u);
  for (let i = 0; i < lines.length; i += 1) {
    if (pattern.test(stripComment(lines[i] ?? ''))) return i + 1;
  }
  return null;
}

/** Line whose trimmed text equals `text` (approximated shader lines). */
function findExactLine(source: string, text: string): number | null {
  const want = text.trim();
  if (!want) return null;
  const lines = source.split(/\r?\n/u);
  for (let i = 0; i < lines.length; i += 1) {
    const got = (lines[i] ?? '').trim().replace(/^[a-z_]+_\d+=`?/iu, '');
    if (got === want || (lines[i] ?? '').includes(want)) return i + 1;
  }
  return null;
}

export function buildCompatChecklist(
  compiled: MilkdropCompiledPreset,
  source: string,
): CompatChecklist {
  const { parity, backends } = compiled.ir.compatibility;
  const items: CompatItem[] = [];
  const seen = new Set<string>();
  const add = (item: CompatItem, key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  for (const detail of parity.blockingConstructDetails) {
    if (detail.classification !== 'hard-unsupported') continue;
    add(
      {
        severity: 'blocker',
        title: `\`${detail.value}\` is not supported`,
        detail:
          detail.kind === 'shader'
            ? 'Stims cannot run this shader construct. Expect a visible difference.'
            : 'Stims cannot render this field. Expect a visible difference.',
        line:
          detail.kind === 'field'
            ? findMilkdropFieldLine(source, detail.value)
            : findWordLine(source, detail.value),
      },
      `blocked:${detail.value}`,
    );
  }

  for (const name of parity.missingAliasesOrFunctions) {
    add(
      {
        severity: 'blocker',
        title: `\`${name}\` is not a known function or variable`,
        detail:
          'It evaluates to 0 at runtime. Check the spelling, or see the Reference tab.',
        line: findWordLine(source, name),
      },
      `missing:${name}`,
    );
  }

  for (const line of parity.approximatedShaderLines) {
    add(
      {
        severity: 'approximation',
        title: 'Shader line is approximated',
        detail: line.trim(),
        line: findExactLine(source, line),
      },
      `approx:${line}`,
    );
  }

  for (const field of parity.ignoredFields) {
    add(
      {
        severity: 'ignored',
        title: `\`${field}\` is ignored`,
        detail: 'Stims does not read this field, so it has no effect here.',
        line: findMilkdropFieldLine(source, field),
      },
      `blocked:${field}`,
    );
  }

  for (const divergence of parity.backendDivergence) {
    add(
      {
        severity: 'note',
        title: 'WebGL and WebGPU differ',
        detail: divergence,
        line: null,
      },
      `divergence:${divergence}`,
    );
  }
  for (const fallback of parity.visualFallbacks) {
    add(
      {
        severity: 'note',
        title: 'Falls back to another renderer',
        detail: fallback.replace('->', ' → '),
        line: null,
      },
      `fallback:${fallback}`,
    );
  }

  items.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER),
  );

  return {
    fidelity: parity.fidelityClass,
    headline: HEADLINES[parity.fidelityClass],
    engines: [
      { engine: 'WebGL', status: backends.webgl.status },
      { engine: 'WebGPU', status: backends.webgpu.status },
    ],
    items,
  };
}
