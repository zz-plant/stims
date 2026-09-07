/**
 * Fail on `border-radius` and `font-size` values that are not on the scale.
 *
 * Both scales existed on paper and neither was followed. The radius block in
 * tokens.css described a "sharp and angular" system topping out at 6px while
 * the stylesheets carried nineteen literal pixel radii up to 28px; the type
 * scale was declared once and then bypassed by 41 distinct rem sizes, 13 of
 * them inside the 0.6–0.85rem band where the steps are smaller than a pixel.
 *
 * Nothing caught either, because a stylesheet with a hand-picked radius is
 * still valid CSS that renders fine on its own — it only shows up as
 * incoherence across surfaces, which no single diff reveals. Hence this
 * check: the scale is only real if something enforces it.
 *
 * A literal is allowed when it lands on a scale step. Preferring the token
 * (`var(--radius-md)`) is better still and always passes, since this only
 * inspects literal values.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

/**
 * Directories to scan. Defaults to the app's stylesheets; a caller may pass
 * roots as arguments, which is how the test suite runs this against fixtures
 * rather than re-implementing the matching and drifting from it.
 */
const CSS_ROOTS =
  process.argv.slice(2).filter((a) => !a.startsWith('-')).length > 0
    ? process.argv.slice(2).filter((a) => !a.startsWith('-'))
    : ['src/css'];

/** Steps from the --radius-* ladder in tokens.css, in px. */
const RADIUS_STEPS = new Set([0, 2, 4, 6, 10, 14, 20, 28, 999]);

/** Steps from the --text-* ladder in tokens.css, in rem. */
const TEXT_STEPS = new Set([
  0.6875, 0.75, 0.8125, 0.875, 0.9375, 1, 1.125, 1.25, 1.5, 1.875, 2.5,
]);

/**
 * Values that are deliberately off-scale, with the reason.
 *
 * Keep this short. An entry here is a claim that the value is not a control
 * corner or a run of text — not that it was inconvenient to change.
 */
const ALLOWED_OFF_SCALE: { file: string; value: string; why: string }[] = [
  {
    file: 'src/css/base.css',
    value: '48px',
    why: 'shapes a blurred ambient glow (::after with filter: blur), not a control corner',
  },
  {
    file: 'src/css/base.css',
    value: '56px',
    why: 'same blurred ambient glow in its focused-session variant',
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (extname(full) === '.css') out.push(full);
  }
  return out;
}

/** Blank out comments while preserving line numbers. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

type Offence = {
  file: string;
  line: number;
  property: string;
  value: string;
  nearest: string;
};

const offences: Offence[] = [];

function isAllowed(file: string, value: string): boolean {
  return ALLOWED_OFF_SCALE.some((a) => a.file === file && a.value === value);
}

function nearestOf(value: number, steps: Set<number>, unit: string): string {
  let best = Number.POSITIVE_INFINITY;
  let pick = value;
  for (const step of steps) {
    const d = Math.abs(step - value);
    if (d < best) {
      best = d;
      pick = step;
    }
  }
  return `${pick}${unit}`;
}

for (const file of CSS_ROOTS.flatMap((r) => walk(r))) {
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    // Every pixel literal in the declaration, not just one after the colon.
    // `border-radius` takes up to eight values (four corners, optionally an
    // elliptical second set after a slash), and a shorthand may lead with a
    // token: `border-radius: var(--radius-xl) 18px 0 0` has an off-scale
    // corner that a first-value-only check waves through — which is exactly
    // what happened, in the same commit that added this file.
    // Percentages (50% for circles) and var() references are left alone.
    for (const decl of line.matchAll(/border-radius:\s*([^;{}]*)/g)) {
      // A length inside calc() is an operand, not a corner: the concentric
      // pattern `calc(var(--ctl-radius) - 3px)` derives an inner radius from
      // the outer one, and the 3px is the gap between them. Blank those out
      // rather than allowlisting each one — the derived value is on the scale
      // by construction, because the token it is derived from is.
      const value = decl[1].replace(/calc\(([^()]|\([^()]*\))*\)/g, (m) =>
        ' '.repeat(m.length),
      );
      for (const m of value.matchAll(/(?<![\w.-])([0-9.]+)px/g)) {
        const raw = `${m[1]}px`;
        if (RADIUS_STEPS.has(Number(m[1])) || isAllowed(file, raw)) continue;
        offences.push({
          file,
          line: i + 1,
          property: 'border-radius',
          value: raw,
          nearest: nearestOf(Number(m[1]), RADIUS_STEPS, 'px'),
        });
      }
    }
    for (const m of line.matchAll(/font-size:\s*([0-9.]+)rem/g)) {
      const raw = `${m[1]}rem`;
      if (TEXT_STEPS.has(Number(m[1])) || isAllowed(file, raw)) continue;
      offences.push({
        file,
        line: i + 1,
        property: 'font-size',
        value: raw,
        nearest: nearestOf(Number(m[1]), TEXT_STEPS, 'rem'),
      });
    }
  });
}

if (offences.length > 0) {
  console.error(
    `✖ ${offences.length} off-scale value${offences.length === 1 ? '' : 's'}:\n`,
  );
  for (const o of offences) {
    console.error(
      `  ${o.file}:${o.line}  ${o.property}: ${o.value}  → nearest step ${o.nearest}`,
    );
  }
  console.error(
    '\nUse a scale token (--radius-* / --text-*) from src/css/tokens.css, or',
  );
  console.error(
    'the nearest step above. If the value genuinely is not a control corner',
  );
  console.error(
    'or a run of UI text, add it to ALLOWED_OFF_SCALE here with the reason.',
  );
  process.exit(1);
}

console.log(
  '✔ every border-radius and font-size sits on the scale (src/css/tokens.css)',
);
