/**
 * Generates docs/authoring/reference.md from the single-source-of-truth
 * builtin table (`src/js/milkdrop/builtin-docs.ts`), so the human reference
 * can never drift from what the compiler and editor actually support.
 *
 *   bun run scripts/generate-authoring-reference.ts          # write
 *   bun run scripts/generate-authoring-reference.ts --check  # CI freshness gate
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  MILKDROP_BUILTIN_DOCS,
  MILKDROP_Q_REGISTER_COUNT,
  MILKDROP_T_REGISTER_COUNT,
  type MilkdropBuiltinDoc,
} from '../src/js/milkdrop/builtin-docs';
import { MILKDROP_EEL_CLOSE_FACTOR } from '../src/js/milkdrop/expression';

const OUT_PATH = resolve(
  import.meta.dir,
  '..',
  join('docs', 'authoring', 'reference.md'),
);
const checkMode = process.argv.includes('--check');

function signature(entry: MilkdropBuiltinDoc) {
  return entry.params?.length
    ? `${entry.name}(${entry.params.join(', ')})`
    : `${entry.name}(x)`;
}

function table(header: [string, string], rows: Array<[string, string]>) {
  return [
    `| ${header[0]} | ${header[1]} |`,
    '|---|---|',
    ...rows.map(([a, b]) => `| ${a} | ${b} |`),
  ].join('\n');
}

const functions = MILKDROP_BUILTIN_DOCS.filter(
  (entry) => entry.kind === 'function',
);
const constants = MILKDROP_BUILTIN_DOCS.filter(
  (entry) => entry.kind === 'constant',
);
const signals = MILKDROP_BUILTIN_DOCS.filter(
  (entry) => entry.kind === 'variable' && entry.group === 'signal',
);
const stateVars = MILKDROP_BUILTIN_DOCS.filter(
  (entry) => entry.kind === 'variable' && entry.group === 'state',
);

const content = `# MilkDrop language reference (Stims)

<!-- GENERATED FILE — do not edit by hand.
     Source of truth: src/js/milkdrop/builtin-docs.ts
     Regenerate: bun run docs:authoring-reference -->

Every name below is derived from the same table the compiler, syntax
highlighter, autocomplete, and hover docs use — if it is listed here, it
compiles. For the guided course, start at [the curriculum](README.md).

## The expression language in ten lines

The equation language is NS-EEL, inherited from Winamp:

- A program is assignments separated by \`;\`. Assigning to any name creates it.
- Every value is a number (double). There are no strings or booleans.
- Comparisons and logic return 1 or 0, and any value within
  \`${MILKDROP_EEL_CLOSE_FACTOR}\` of zero is false — \`if(x, a, b)\`, \`above\`,
  \`below\`, \`equal\`, \`band\`, \`bor\`, \`bnot\` are the branching toolkit
  (\`if\` evaluates both branches; there is no short-circuit).
- Names are case-insensitive. \`//\` starts a comment.
- Operators: \`+ - * / % ^\` (power), comparisons \`< <= > >= == !=\`,
  logic \`&& || !\`.
- Numeric literals accept decimals, exponents (\`1e-3\`), and hex (\`0x1f\`).
- \`megabuf(i)\` / \`gmegabuf(i)\` read indexed storage; assigning to
  \`megabuf(i) = v\` writes it (per-preset vs global).

## Functions

${table(
  ['Function', 'Meaning'],
  functions.map((entry) => [`\`${signature(entry)}\``, entry.doc]),
)}

## Constants

${table(
  ['Constant', 'Meaning'],
  constants.map((entry) => [`\`${entry.name}\``, entry.doc]),
)}

## Signals (read-only inputs)

Fed by the runtime every frame. Audio bands are the heart of reactivity —
see Track 3 of the curriculum for how to use them well.

${table(
  ['Variable', 'Meaning'],
  signals.map((entry) => [`\`${entry.name}\``, entry.doc]),
)}

Stims also exposes interaction and device-motion signals (\`inputX\`,
\`gestureScale\`, \`motionX\`, …) that are **not standard MilkDrop** — see the
[signal contract](../MILKDROP_PRESET_RUNTIME.md) before relying on them.

## Render state (read/write knobs)

Written by \`per_frame\`/\`per_pixel\` code to steer the feedback loop —
[Track 1](01-how-milkdrop-thinks.md) and [Track 2](02-motion.md) teach these.

${table(
  ['Variable', 'Meaning'],
  stateVars.map((entry) => [`\`${entry.name}\``, entry.doc]),
)}

## Registers

- \`q1\`–\`q${MILKDROP_Q_REGISTER_COUNT}\` — persistent globals: the bridge
  between variable pools. Set in \`per_frame\`, readable in \`per_pixel\`,
  custom wave/shape code, and as shader uniforms.
- \`t1\`–\`t${MILKDROP_T_REGISTER_COUNT}\` — per-slot temporaries for custom
  waves and shapes.

## Where code runs

| Block | Runs | Notes |
|---|---|---|
| \`per_frame_init_N\` / \`per_frame_N\` | once per frame | set knobs, read audio |
| \`per_pixel_N\` | per mesh point | also reads \`x\`, \`y\`, \`rad\`, \`ang\` |
| \`wavecode_N_*\` + \`wave_N_per_point_N\` | per custom-wave sample | reads \`sample\`, writes \`x y r g b a\` |
| \`shapecode_N_*\` (\`init\`/\`per_frame\`) | per shape instance | writes \`x y rad ang sides r g b a …\` |
| \`[warp_shader]\` / \`[comp_shader]\` | per pixel on the GPU | GLSL 1.20 — see the [coding guide](../MILKDROP_CODING_GUIDE.md#the-glsl-shader-era-2008present) |

Shader uniforms, samplers, and engine limits are documented in the
[coding guide](../MILKDROP_CODING_GUIDE.md#engine-limitations) and the
[shader support inventory](../architecture/shader-support-inventory.md).
`;

if (checkMode) {
  let current = '';
  try {
    current = readFileSync(OUT_PATH, 'utf8');
  } catch {
    // missing counts as stale
  }
  if (current !== content) {
    console.error(
      'docs/authoring/reference.md is stale — run: bun run docs:authoring-reference',
    );
    process.exit(1);
  }
  console.log('docs/authoring/reference.md is current.');
} else {
  writeFileSync(OUT_PATH, content);
  console.log(
    `wrote docs/authoring/reference.md (${functions.length} functions, ${signals.length} signals, ${stateVars.length} state vars)`,
  );
}
