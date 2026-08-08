/**
 * Report (and optionally remove) CSS rules whose selectors reference only
 * classes that appear nowhere in the markup or JS that ships.
 *
 * Conservative by design:
 *  - A rule is removable only if EVERY selector in its list is removable, and a
 *    selector is removable only if it mentions at least one class and ALL of its
 *    classes are dead. Anything touching an element/attribute/pseudo-only
 *    selector, an id, or a single live class is left alone.
 *  - Third-party class families (CodeMirror) are never considered dead; the
 *    library applies them at runtime so they never appear in our sources.
 *  - Reports by default. Pass --apply to rewrite the files.
 *
 * Known limitation: a rule scoped under a dead ancestor but naming a live
 * descendant (`.dead-container .live-child`) is kept, because judging it needs
 * the DOM rather than a token scan. Those rules are unreachable in practice, so
 * re-running after deleting a container's markup can surface a further pass.
 *
 *   node scripts/prune-dead-css.mjs
 *   node scripts/prune-dead-css.mjs --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const APPLY = process.argv.includes('--apply');

// Stylesheets to consider. Module stylesheets are excluded: their class names
// are rewritten at build time and referenced via the `styles` object, so a
// source scan cannot see them.
const SHEETS = [
  'src/css/base.css',
  'src/css/index.css',
  'src/css/app-shell.css',
  'src/css/chrome.css',
  'src/css/shell-launch.css',
  'src/css/shell-theme.css',
];

// Class families applied by third-party code at runtime.
const EXTERNAL_PREFIXES = ['cm-', 'ͼ'];

const SOURCE_GLOB_DIRS = ['src/js'];
const SOURCE_FILES = ['index.html', 'milkdrop/index.html'];
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

/** Every identifier-shaped token in the shipping sources. */
function collectSourceTokens() {
  const tokens = new Set();
  for (const file of collectSourceFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/[A-Za-z0-9_-]+/g)) {
      tokens.add(match[0]);
    }
  }
  return tokens;
}

function isExternal(className) {
  return EXTERNAL_PREFIXES.some((prefix) => className.startsWith(prefix));
}

/** Class names mentioned in a single (comma-free) selector. */
function classesIn(selector) {
  return [...selector.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)].map(
    (match) => match[1],
  );
}

function main() {
  const tokens = collectSourceTokens();
  const isDead = (className) =>
    !isExternal(className) && !tokens.has(className);

  let totalRules = 0;
  let totalRemoved = 0;
  const perSheet = [];

  for (const relative of SHEETS) {
    const file = path.join(REPO_ROOT, relative);
    if (!fs.existsSync(file)) {
      continue;
    }
    const css = fs.readFileSync(file, 'utf8');
    const root = postcss.parse(css, { from: file });

    const removed = [];
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
      if (selectors.length === 0) {
        return;
      }

      const removable = selectors.every((selector) => {
        const classes = classesIn(selector);
        if (classes.length === 0) {
          return false; // element/pseudo/attribute-only: out of scope
        }
        if (/#[A-Za-z_]/.test(selector)) {
          return false; // id-anchored: out of scope
        }
        return classes.every(isDead);
      });

      if (removable) {
        removed.push({
          selector: rule.selector.replace(/\s+/g, ' ').trim(),
          decls: rule.nodes?.length ?? 0,
        });
        rule.remove();
      }
    });

    // Clean up at-rules (media/supports/layer) left with no children.
    let prunedAtRules = 0;
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
        prunedAtRules += 1;
        changed = true;
      });
    }

    totalRemoved += removed.length;
    const before = css.split('\n').length;
    const output = root.toResult().css;
    const after = output.split('\n').length;
    perSheet.push({
      relative,
      rules: removed.length,
      prunedAtRules,
      before,
      after,
      removed,
    });

    if (APPLY && removed.length > 0) {
      fs.writeFileSync(file, output);
    }
  }

  for (const sheet of perSheet) {
    if (sheet.rules === 0) {
      console.log(`  ${sheet.relative}: clean`);
      continue;
    }
    console.log(
      `  ${sheet.relative}: ${sheet.rules} dead rule(s), ` +
        `${sheet.prunedAtRules} empty at-rule(s), ` +
        `${sheet.before} -> ${sheet.after} lines`,
    );
  }
  console.log(
    `\n${totalRemoved} of ${totalRules} rules reference only dead classes.`,
  );
  if (!APPLY && totalRemoved > 0) {
    console.log('Re-run with --apply to rewrite the stylesheets.');
  }

  if (process.argv.includes('--list')) {
    for (const sheet of perSheet) {
      for (const item of sheet.removed) {
        console.log(`${sheet.relative}\t${item.selector}`);
      }
    }
  }
}

main();
