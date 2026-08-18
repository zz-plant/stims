/**
 * GPU-field tier differential fuzz: per-pixel programs that the planner can
 * lower must compute the same values on the CPU JIT and on the GPU
 * descriptor path. The GPU side is evaluated by a JS reference that mirrors
 * the WGSL emitter's semantics exactly (helpers in
 * webgpu-procedural-materials.ts) — keep the two in lockstep when editing
 * either. First run found six divergence classes across 32% of lowered
 * programs: float-floor vs truncated-int '%', unguarded log/division/pow/
 * sqrt/asin/acos, int() as floor vs trunc, a tenfold close-factor gap, and
 * no per-statement finite clamp on the GPU side.
 */
import { describe, expect, test } from 'bun:test';
import type {
  MilkdropCompiledStatement,
  MilkdropProgramBlock,
} from '../../src/js/milkdrop/common-types.ts';
import { lowerGpuFieldProgram } from '../../src/js/milkdrop/compiler/gpu-field-planner.ts';
import { parseMilkdropStatement } from '../../src/js/milkdrop/expression.ts';
import { compileMilkdropProgram } from '../../src/js/milkdrop/expression-jit.ts';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATE_VARS = [
  'x',
  'y',
  'rad',
  'ang',
  'zoom',
  'zoomexp',
  'rot',
  'warp',
  'cx',
  'cy',
  'sx',
  'sy',
  'dx',
  'dy',
];
const TEMP_VARS = ['t1', 't2', 't3'];
// Frame-constant register inputs (q registers and per-frame user vars):
// read-only in the generator so the planner classifies them as
// registerInputs — the q-var lowering path — rather than temporaries.
const REGISTER_VARS = ['q1', 'q20', 'q31', 'frameuser'];
const VARS = [...STATE_VARS, ...TEMP_VARS];
const READ_VARS = [...VARS, ...REGISTER_VARS];
const UNARY_FNS = [
  'sin',
  'cos',
  'tan',
  'abs',
  'sqrt',
  'sqr',
  'exp',
  'log',
  'log10',
  'sign',
  'int',
  'floor',
  'ceil',
  'frac',
  'bnot',
];
const BINARY_FNS = [
  'pow',
  'min',
  'max',
  'atan2',
  'above',
  'below',
  'equal',
  'mod',
];
const BIN_OPS = [
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '&&',
  '||',
  '<',
  '>',
  '<=',
  '>=',
  '==',
  '!=',
];

function genExpr(rnd: () => number, depth: number): string {
  const roll = rnd();
  if (depth <= 0 || roll < 0.28) {
    return rnd() < 0.5
      ? (rnd() * 8 - 4).toFixed(4)
      : READ_VARS[Math.floor(rnd() * READ_VARS.length)];
  }
  if (roll < 0.52) {
    return `${UNARY_FNS[Math.floor(rnd() * UNARY_FNS.length)]}(${genExpr(rnd, depth - 1)})`;
  }
  if (roll < 0.66) {
    const fn = BINARY_FNS[Math.floor(rnd() * BINARY_FNS.length)];
    return `${fn}(${genExpr(rnd, depth - 1)},${genExpr(rnd, depth - 1)})`;
  }
  if (roll < 0.74) {
    return `if(${genExpr(rnd, depth - 1)},${genExpr(rnd, depth - 1)},${genExpr(rnd, depth - 1)})`;
  }
  const op = BIN_OPS[Math.floor(rnd() * BIN_OPS.length)];
  return `(${genExpr(rnd, depth - 1)} ${op} ${genExpr(rnd, depth - 1)})`;
}

function genProgram(rnd: () => number): string[] {
  const lines: string[] = [];
  const count = 2 + Math.floor(rnd() * 4);
  for (let i = 0; i < count; i++) {
    lines.push(`${VARS[Math.floor(rnd() * VARS.length)]} = ${genExpr(rnd, 3)}`);
  }
  return lines;
}

function parseProgram(lines: string[]): MilkdropProgramBlock | null {
  const statements: MilkdropCompiledStatement[] = [];
  for (const [i, line] of lines.entries()) {
    const parsed = parseMilkdropStatement(line, i + 1);
    if (!parsed.value) return null;
    if (parsed.diagnostics.some((d) => d.severity === 'error')) return null;
    statements.push(parsed.value);
  }
  return { statements, sourceLines: lines };
}

// --- Reference evaluation of the descriptor, WGSL-emitter semantics ------
const GPU_CLOSE = 0.00001;
const gpuBool = (v: number) => (Math.abs(v) > GPU_CLOSE ? 1 : 0);
const gpuMod = (l: number, r: number) => {
  const m = Math.abs(r) <= GPU_CLOSE ? 0 : l - r * Math.trunc(l / r);
  return m === 0 ? signedZero(l) : m;
};
const signedZero = (l: number) =>
  Object.is(Math.sign(l), -0) || l < 0 ? -0 : 0;
const gpuIntMod = (l: number, r: number) => {
  const li = Math.trunc(l);
  const ri = Math.trunc(r);
  const m = ri === 0 ? 0 : li - ri * Math.trunc(li / ri);
  // Dividend-signed zero, matching C remainder and the WGSL helper.
  return m === 0 ? signedZero(l) : m;
};
const gpuFinite = (v: number) => (Math.abs(v) < 3.402823e38 ? v : 0);
const gpuPow = (b: number, ex: number) => gpuFinite(b ** ex);
const gpuLog = (v: number) => gpuFinite(Math.log(Math.max(v, 0)));
const gpuDiv = (l: number, r: number) => (r === 0 ? 0 : l / r);

type GpuExpr = {
  type: string;
  value?: number;
  name?: string;
  operator?: string;
  operand?: GpuExpr;
  left?: GpuExpr;
  right?: GpuExpr;
  args?: GpuExpr[];
};

function evalGpu(e: GpuExpr, env: Record<string, number>): number {
  switch (e.type) {
    case 'literal':
      return e.value ?? 0;
    case 'identifier': {
      const n = (e.name ?? '').toLowerCase();
      if (n === 'pi') return Math.PI;
      if (n === 'e') return Math.E;
      return env[n] ?? 0;
    }
    case 'unary': {
      const v = evalGpu(e.operand as GpuExpr, env);
      if (e.operator === '!') return gpuBool(v) > 0.5 ? 0 : 1;
      return e.operator === '-' ? -v : v;
    }
    case 'binary': {
      const l = evalGpu(e.left as GpuExpr, env);
      const r = evalGpu(e.right as GpuExpr, env);
      switch (e.operator) {
        case '^':
          return gpuPow(l, r);
        case '%':
          return gpuIntMod(l, r);
        case '<':
          return l < r ? 1 : 0;
        case '<=':
          return l <= r ? 1 : 0;
        case '>':
          return l > r ? 1 : 0;
        case '>=':
          return l >= r ? 1 : 0;
        case '==':
          return l === r ? 1 : 0;
        case '!=':
          return l !== r ? 1 : 0;
        case '&&':
          return gpuBool(l) > 0.5 && gpuBool(r) > 0.5 ? 1 : 0;
        case '||':
          return gpuBool(l) > 0.5 || gpuBool(r) > 0.5 ? 1 : 0;
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '/':
          return gpuDiv(l, r);
        default:
          return 0;
      }
    }
    case 'call': {
      const a = (e.args ?? []).map((x) => evalGpu(x, env));
      switch (e.name) {
        case 'sin':
          return Math.sin(a[0]);
        case 'cos':
          return Math.cos(a[0]);
        case 'tan':
          return Math.tan(a[0]);
        case 'abs':
          return Math.abs(a[0]);
        case 'sqrt':
          return Math.sqrt(Math.max(a[0], 0));
        case 'asin':
          return Math.asin(Math.min(1, Math.max(-1, a[0])));
        case 'acos':
          return Math.acos(Math.min(1, Math.max(-1, a[0])));
        case 'pow':
          return gpuPow(a[0], a[1]);
        case 'mod':
        case 'fmod':
          return gpuMod(a[0], a[1]);
        case 'min':
          return Math.min(a[0], a[1]);
        case 'max':
          return Math.max(a[0], a[1]);
        case 'floor':
          return Math.floor(a[0]);
        case 'int':
          return Math.trunc(a[0]);
        case 'ceil':
          return Math.ceil(a[0]);
        case 'sqr':
          return a[0] * a[0];
        case 'log':
          return gpuLog(a[0]);
        case 'log10':
          return gpuLog(a[0]) * Math.LOG10E;
        case 'exp':
          return Math.exp(a[0]);
        case 'sign':
          return Math.sign(a[0]) || 0;
        case 'bnot':
          return gpuBool(a[0]) > 0.5 ? 0 : 1;
        case 'atan2':
          return Math.atan2(a[0], a[1]);
        case 'frac':
          return a[0] - Math.floor(a[0]);
        case 'if':
          return Math.abs(a[0]) > GPU_CLOSE ? a[1] : a[2];
        case 'above':
          return a[0] > a[1] ? 1 : 0;
        case 'below':
          return a[0] < a[1] ? 1 : 0;
        case 'equal':
          return Math.abs(a[0] - a[1]) <= GPU_CLOSE ? 1 : 0;
        default:
          return Number.NaN;
      }
    }
    default:
      return 0;
  }
}

const closeEnough = (a: number, b: number) => {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  return Math.abs(a - b) <= 1e-6 + 1e-4 * Math.max(Math.abs(a), Math.abs(b));
};

describe('GPU field tier differential', () => {
  test('JIT and lowered-descriptor semantics agree on seeded programs', () => {
    let lowered = 0;
    let _skipped = 0;
    let mismatches = 0;
    const classes = new Map<string, { count: number; example: string }>();

    for (let seed = 1; seed <= 2000; seed++) {
      const rnd = mulberry32(seed);
      const lines = genProgram(rnd);
      const block = parseProgram(lines);
      if (!block) {
        _skipped++;
        continue;
      }
      const descriptor = lowerGpuFieldProgram(block, {
        registerInputs: REGISTER_VARS,
      });
      if (!descriptor) {
        _skipped++;
        continue;
      }
      lowered++;

      const inputRnd = mulberry32(seed * 104729);
      const env: Record<string, number> = {};
      for (const v of READ_VARS) env[v] = inputRnd() * 4 - 2;

      const envJit = { ...env };
      try {
        compileMilkdropProgram(block)(
          envJit,
          {},
          {},
          null,
          new Float32Array(4),
          new Float32Array(4),
          () => 0.5,
        );
      } catch {
        continue;
      }

      const envGpu = { ...env };
      for (const st of (
        descriptor as {
          statements: Array<{ target: string; expression: GpuExpr }>;
        }
      ).statements) {
        envGpu[st.target.toLowerCase()] = gpuFinite(
          evalGpu(st.expression, envGpu),
        );
      }

      for (const key of VARS) {
        const a = envJit[key] ?? 0;
        const b = envGpu[key] ?? 0;
        if (!closeEnough(a, b)) {
          mismatches++;
          const line =
            lines.find((l) => l.startsWith(`${key} `)) ?? lines.join(' | ');
          const label = /%|mod\(/.test(line)
            ? 'mod-semantics'
            : /int\(/.test(line)
              ? 'int-floor-vs-trunc'
              : /log/.test(line)
                ? 'log-domain'
                : /\//.test(line)
                  ? 'div-by-zero'
                  : /equal|==|bnot|&&|\|\|/.test(line)
                    ? 'close-factor'
                    : 'other';
          const entry = classes.get(label) ?? { count: 0, example: '' };
          entry.count++;
          if (!entry.example) {
            entry.example = `seed ${seed}: ${key} jit=${a} gpu=${b}\n    ${line}`;
          }
          classes.set(label, entry);
          break;
        }
      }
    }

    const summary = [...classes].map(
      ([label, info]) => `[${label}] x${info.count}\n  ${info.example}`,
    );
    expect({ lowered, mismatches, summary }).toEqual({
      lowered,
      mismatches: 0,
      summary: [],
    });
    expect(lowered).toBeGreaterThan(500);
  }, 60000);
});
