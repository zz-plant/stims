/**
 * Report (and optionally remove) CSS selectors that need a class no shipping
 * markup or JS ever applies.
 *
 * A selector is dead when it requires such a class: any element it matches
 * must carry every class named outside a functional pseudo-class, so one
 * class that is never applied means it matches nothing. A rule whose
 * selectors are all dead goes; a mixed list loses only its dead selectors.
 * An `@keyframes` block goes when no stylesheet or source names it once the
 * dead rules are gone.
 *
 * What counts as applied:
 *  - Every identifier-shaped token in `src/js` and each Vite HTML entry.
 *  - Any class starting with a template-built BEM prefix: `foo--${state}`
 *    applies every `foo--*` modifier, though no source spells one out.
 *  - Third-party families (CodeMirror), which the library applies at runtime.
 *
 * Classes inside `:not()`, `:is()`, `:where()` and `:has()` are not counted:
 * `:not(.dead)` matches everything, so it never makes a selector dead.
 * Module stylesheets are out of scope: the build renames their classes. They
 * still count as users of a keyframe name.
 *
 * Reports by default. Pass --apply to rewrite the files, then run Biome and
 * read the diff: a comment that introduced a removed rule or keyframe stays
 * behind, and --list names each one so you can delete it by hand.
 *
 *   node scripts/prune-dead-css.mjs
 *   node scripts/prune-dead-css.mjs --list
 *   node scripts/prune-dead-css.mjs --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const APPLY = process.argv.includes('--apply');
const LIST = process.argv.includes('--list');

// Every global stylesheet under src/css. Module stylesheets are excluded:
// their class names are rewritten at build time and referenced via the
// `styles` object, so a source scan cannot see them.
const SHEETS = collectStylesheets()
  .filter((file) => !file.endsWith('.module.css'))
  .map((file) => path.relative(REPO_ROOT, file))
  .sort();

// Class families applied by third-party code at runtime.
const EXTERNAL_PREFIXES = ['cm-', 'ͼ'];

const SOURCE_GLOB_DIRS = ['src/js', 'certify'];
// Every HTML entry in vite.config.js and vite.config.ui.js. The performance
// page and the UI harness load base.css and app-shell.css too.
const SOURCE_FILES = [
  'index.html',
  'milkdrop/index.html',
  'certify/index.html',
  'performance/index.html',
  'ui-harness.html',
];
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.html']);

function collectSourceFiles() {
  const files = SOURCE_FILES.map((file) => path.join(REPO_ROOT, file)).filter(
    (file) => fs.existsSync(file),
  );
  for (const dir of SOURCE_GLOB_DIRS) {
    const stack = [path.join(REPO_ROOT, dir)];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (SOURCE_EXTS.has(path.extname(entry.name))) {
          files.push(full);
        }
      }
    }
  }
  return files;
}

/**
 * Every identifier-shaped token in the shipping sources, plus each BEM prefix
 * a template literal completes at runtime (`foo--${state}` gives `foo--`).
 */
function collectSourceTokens() {
  const tokens = new Set();
  const prefixes = new Set();
  for (const file of collectSourceFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/[A-Za-z0-9_-]+/g)) {
      tokens.add(match[0]);
    }
    for (const match of text.matchAll(/([A-Za-z0-9_-]+(?:--|__))\$\{/g)) {
      prefixes.add(match[1]);
    }
  }
  return { tokens, prefixes: [...prefixes] };
}

function isExternal(className) {
  return EXTERNAL_PREFIXES.some((prefix) => className.startsWith(prefix));
}

/**
 * Class names a single (comma-free) selector requires. Text inside brackets
 * and parentheses is dropped: an attribute value is not a class, and a
 * functional pseudo-class does not require what it names.
 */
function requiredClasses(selector) {
  let outer = '';
  let depth = 0;
  for (const char of selector) {
    if (char === '(' || char === '[') {
      depth += 1;
    } else if (char === ')' || char === ']') {
      depth -= 1;
    } else if (depth === 0) {
      outer += char;
    }
  }
  return [...outer.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)].map(
    (match) => match[1],
  );
}

const compact = (selector) => selector.replace(/\s+/g, ' ').trim();

/** Every `.css` file under src/css, module stylesheets included. */
function collectStylesheets() {
  const files = [];
  const stack = [path.join(REPO_ROOT, 'src/css')];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.endsWith('.css')) {
        files.push(full);
      }
    }
  }
  return files;
}

/** Identifiers used in declaration values: where animation names appear. */
function valueTokens(root, into) {
  root.walkDecls((decl) => {
    for (const match of decl.value.matchAll(/[A-Za-z0-9_-]+/g)) {
      into.add(match[0]);
    }
  });
}

function noteCommentAbove(node, comments) {
  const previous = node.prev();
  if (previous?.type === 'comment') {
    comments.push({ line: previous.source?.start?.line });
  }
}

function main() {
  const { tokens, prefixes } = collectSourceTokens();
  const isDead = (className) =>
    !isExternal(className) &&
    !tokens.has(className) &&
    !prefixes.some((prefix) => className.startsWith(prefix));
  const isDeadSelector = (selector) => requiredClasses(selector).some(isDead);

  let totalRules = 0;
  let totalRemoved = 0;
  let totalTrimmed = 0;
  let totalKeyframes = 0;
  const perSheet = [];

  for (const relative of SHEETS) {
    const file = path.join(REPO_ROOT, relative);
    const css = fs.readFileSync(file, 'utf8');
    const root = postcss.parse(css, { from: file });

    const removed = [];
    const trimmed = [];
    const comments = [];
    root.walkRules((rule) => {
      totalRules += 1;

      // Never touch keyframe steps (`from`, `to`, `50%`).
      if (
        rule.parent?.type === 'atrule' &&
        /keyframes$/i.test(rule.parent.name)
      ) {
        return;
      }

      const selectors = rule.selectors ?? [];
      const dead = selectors.filter(isDeadSelector);
      if (dead.length === 0) {
        return;
      }
      const line = rule.source?.start?.line;
      if (dead.length < selectors.length) {
        trimmed.push({ line, dead: dead.map(compact) });
        rule.selectors = selectors.filter(
          (selector) => !dead.includes(selector),
        );
        return;
      }
      removed.push({ line, selector: compact(rule.selector) });
      noteCommentAbove(rule, comments);
      rule.remove();
    });

    perSheet.push({ relative, file, css, root, removed, trimmed, comments });
  }

  // Keyframe names still in use, read after the dead rules are gone: a rule
  // removed above may have been the only one animating with a name.
  const animationNames = new Set(tokens);
  const pruned = new Set(perSheet.map((sheet) => sheet.file));
  for (const sheet of perSheet) {
    valueTokens(sheet.root, animationNames);
  }
  for (const file of collectStylesheets()) {
    if (!pruned.has(file)) {
      valueTokens(postcss.parse(fs.readFileSync(file, 'utf8')), animationNames);
    }
  }

  for (const sheet of perSheet) {
    const { root, css } = sheet;
    sheet.keyframes = [];
    root.walkAtRules(/keyframes$/i, (atRule) => {
      if (animationNames.has(atRule.params.trim())) {
        return;
      }
      sheet.keyframes.push({
        line: atRule.source?.start?.line,
        name: atRule.params.trim(),
      });
      noteCommentAbove(atRule, sheet.comments);
      atRule.remove();
    });

    // Clean up at-rules (media/supports/layer) left with no children.
    sheet.prunedAtRules = 0;
    let changed = true;
    while (changed) {
      changed = false;
      root.walkAtRules((atRule) => {
        if (
          !/^(media|supports|layer|scope|container)$/i.test(atRule.name) ||
          (atRule.nodes?.length ?? 0) > 0
        ) {
          return;
        }
        atRule.remove();
        sheet.prunedAtRules += 1;
        changed = true;
      });
    }

    totalRemoved += sheet.removed.length;
    totalTrimmed += sheet.trimmed.length;
    totalKeyframes += sheet.keyframes.length;
    const output = root.toResult().css;
    sheet.before = css.split('\n').length;
    sheet.after = output.split('\n').length;

    if (APPLY && output !== css) {
      fs.writeFileSync(sheet.file, output);
    }
  }

  for (const sheet of perSheet) {
    if (
      sheet.removed.length + sheet.trimmed.length + sheet.keyframes.length ===
      0
    ) {
      console.log(`  ${sheet.relative}: clean`);
      continue;
    }
    console.log(
      `  ${sheet.relative}: ${sheet.removed.length} dead rule(s), ` +
        `${sheet.trimmed.length} trimmed selector list(s), ` +
        `${sheet.keyframes.length} unused keyframe(s), ` +
        `${sheet.prunedAtRules} empty at-rule(s), ` +
        `${sheet.before} -> ${sheet.after} lines`,
    );
  }
  console.log(
    `\n${totalRemoved} of ${totalRules} rules match nothing; ` +
      `${totalTrimmed} more keep some selectors; ` +
      `${totalKeyframes} keyframe(s) are never used.`,
  );
  if (!APPLY && totalRemoved + totalTrimmed + totalKeyframes > 0) {
    console.log('Re-run with --apply to rewrite the stylesheets.');
  }

  if (LIST) {
    for (const sheet of perSheet) {
      for (const item of sheet.removed) {
        console.log(`${sheet.relative}:${item.line}\trule\t${item.selector}`);
      }
      for (const item of sheet.trimmed) {
        console.log(
          `${sheet.relative}:${item.line}\tselectors\t${item.dead.join(', ')}`,
        );
      }
      for (const item of sheet.keyframes) {
        console.log(`${sheet.relative}:${item.line}\tkeyframes\t${item.name}`);
      }
      for (const item of sheet.comments) {
        console.log(
          `${sheet.relative}:${item.line}\tcomment above a removed node`,
        );
      }
    }
  }
}

main();
