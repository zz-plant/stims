/**
 * Fail on `z-index` values that opt out of the layer scale in tokens.css.
 *
 * The scale is a shared claim about what sits above what: a lab panel below a
 * dialog, a toast above the dock, a skip link above all of it. A raw number
 * makes that claim privately, and privately made claims collide. They had:
 * StrudelLabPanel declared `z-index: 40`, which is exactly --z-modal-backdrop,
 * so an open dialog's scrim and a floating tool panel occupied one layer and
 * paint order fell to DOM order. It rendered correctly only by accident of
 * which element happened to come last.
 *
 * Nothing caught it because a hand-picked z-index is valid CSS that looks
 * right in the state you tested. It surfaces as one surface covering another
 * in a combination nobody opened — the same reason check-css-scale.ts exists
 * for radius and type.
 *
 * The rule: at or above --z-nav (10), where the global chrome scale starts,
 * use a token. Below that, a literal is fine and usually better — a `z-index:
 * 1` that lifts an image over its own tile is local stacking inside one
 * component and makes no claim about the app's layers. Reaching for
 * var(--z-stage-root) there would assert kinship with the stage from inside a
 * browse panel, which is how the misleading ones got written.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

/**
 * Roots to scan. Defaults to the app source; a caller may pass roots as
 * arguments, which is how the test suite runs this against fixtures rather
 * than re-implementing the matching and drifting from it.
 */
const ROOTS =
  process.argv.slice(2).filter((a) => !a.startsWith('-')).length > 0
    ? process.argv.slice(2).filter((a) => !a.startsWith('-'))
    : ['src'];

const SCANNED = new Set(['.css', '.ts', '.tsx']);

/**
 * The layer where the global scale begins (--z-nav). Below this, a literal is
 * local stacking within one component and needs no token.
 */
const GLOBAL_SCALE_FLOOR = 10;

/**
 * Literals that are deliberately outside the scale, with the reason.
 *
 * Keep this short. An entry is a claim that the value orders siblings inside
 * one component — not that picking a token was inconvenient.
 */
const ALLOWED: { file: string; value: number; reason: string }[] = [];

type Offence = {
  file: string;
  line: number;
  value: string;
  context: string;
};

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (SCANNED.has(extname(full))) out.push(full);
  }
  return out;
}

/**
 * Every spelling a layer gets declared in: `z-index: 40` in CSS and in inline
 * style strings, `zIndex: 40` in a JSX style prop or style object, and
 * `el.style.zIndex = '80'` imperatively. The first version of this matched
 * only the hyphenated form, so the camel-case ones — the normal way to do it
 * in a component — passed straight through a guard that advertised scanning
 * .ts/.tsx.
 */
const Z_INDEX = /\bz-?index\s*[:=]\s*([^;,}\n]+)/gi;

const offences: Offence[] = [];

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      // A line that only talks about z-index in prose is not a declaration.
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      Z_INDEX.lastIndex = 0;
      let match: RegExpExecArray | null = Z_INDEX.exec(line);
      while (match !== null) {
        // `zIndex: '80'` and `z-index: 80` should read the same.
        const raw = match[1]
          .trim()
          .replace(/^['"`]|['"`]$/g, '')
          .trim();
        if (!raw.includes('var(--z-')) {
          const value = Number.parseInt(raw, 10);
          if (
            !Number.isNaN(value) &&
            Math.abs(value) >= GLOBAL_SCALE_FLOOR &&
            !ALLOWED.some((a) => file.endsWith(a.file) && a.value === value)
          ) {
            offences.push({
              file,
              line: index + 1,
              value: raw,
              context: line.trim().slice(0, 72),
            });
          }
        }
        match = Z_INDEX.exec(line);
      }
    });
  }
}

if (offences.length > 0) {
  console.error(
    `✖ ${offences.length} z-index value${offences.length === 1 ? '' : 's'} bypassing the layer scale:\n`,
  );
  for (const o of offences) {
    console.error(`  ${o.file}:${o.line}  ${o.context}`);
  }
  console.error(
    `\nAt or above ${GLOBAL_SCALE_FLOOR} the value is a claim about the app's layers,`,
  );
  console.error(
    'so name it: use a --z-* token from src/css/tokens.css, or add one there',
  );
  console.error(
    'in numeric order with a comment saying what it sits between. A value that',
  );
  console.error(
    'only orders siblings inside one component belongs below the floor instead.',
  );
  process.exit(1);
}

console.log(
  `✔ every z-index at or above ${GLOBAL_SCALE_FLOOR} names its layer (src/css/tokens.css)`,
);
