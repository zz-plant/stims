#!/usr/bin/env bun
/**
 * Fail on UI anti-patterns the token and scale checks don't model.
 *
 * The CSS guards above encode our own rules: values on the scale, colors on
 * the tokens, layers named. They cannot see a pattern that is technically
 * valid CSS and still wrong — a colored stripe on the left of a plain card,
 * text rendered in a gradient, a headline sized to fill the first screen by
 * itself. Those are the recurring tells of generated UI, and they arrive
 * looking finished: they pass typecheck, pass biome, and read fine in the one
 * state the author opened. This scan is a second opinion with a larger
 * catalogue (impeccable), covering slop tells plus quality issues that only
 * show up in relation to layout — overflow, contrast, line length.
 *
 * The rule is not "never ship a left stripe". Toasts and diagnostics here use
 * exactly that stripe, because the stripe carries status. A finding is a
 * question, and the answer lives next to the code: an intentional use carries
 * an inline disable comment naming the rule and the design reason. A bare
 * finding means the pattern arrived unexplained, and the fix is either to
 * remove it or to write down why it belongs.
 *
 * The tool runs pinned (IMPECCABLE_VERSION) rather than as a dependency: the
 * rule set is an opinion that changes with design fashion, and a floating
 * latest would let a catalogue update silently change what the gate demands.
 * Bump the pin deliberately, with the diff it introduces in hand.
 */
import { spawnSync } from 'node:child_process';

/** Pinned so a catalogue update cannot move the gate without a decision. */
const IMPECCABLE_VERSION = '4.5.2';

/** Source root, resolved from this file so the cwd cannot change the target. */
const SRC = new URL('../src', import.meta.url).pathname;

const result = spawnSync(
  'bunx',
  [`impeccable@${IMPECCABLE_VERSION}`, 'detect', SRC],
  {
    stdio: ['ignore', 'inherit', 'inherit'],
  },
);

if (result.status === 0) {
  console.log('✔ no unexplained UI anti-patterns in src/');
  process.exit(0);
}

if (result.status === 2) {
  console.error(
    `\nimpeccable found unexplained anti-patterns above. For each one: fix it,`,
  );
  console.error(
    `or keep it with its reason inline — an impeccable-disable-line comment`,
  );
  console.error(
    `naming the rule, on the line the pattern lives on. A bare finding is a`,
  );
  console.error(`pattern nobody defended.`);
  process.exit(1);
}

console.error(
  `\nimpeccable could not run (exit ${result.status}, signal ${result.signal}).`,
);
console.error(
  `The scan is the only thing that checks for these patterns, so a scan that`,
);
console.error(
  `did not run fails the gate rather than passing silently. Check network`,
);
console.error(
  `access for bunx, or run \`bunx impeccable@${IMPECCABLE_VERSION} detect src/\` directly.`,
);
process.exit(1);
