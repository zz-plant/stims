/**
 * Plain-rule copies of `@scope` blocks for engines that drop them.
 *
 * Chromium shipped `@scope` in 118. Older engines discard each `@scope` block
 * whole, and the shell keeps most of its layout in them (`app-shell.css`,
 * `chrome.css`, `shell-launch.css`). Measured on an RG Vita Pro, whose AOSP
 * WebView 116 cannot be updated: the stage canvas laid out 809×1 px and the
 * launch art filled the screen.
 *
 * The entry loads this module only when `CSSScopeRule` is missing, and holds
 * the shell's mount until the rules are back. Those engines keep every rule
 * outside the blocks where it was, so only the scoped
 * rules are rebuilt, from each sheet's text, into one `<style>` kept after
 * every other stylesheet:
 * - a bare selector `S` becomes `:where(R) S`, since a scoped selector is
 *   relative to an implied `:scope` that adds no specificity;
 * - `:scope` becomes `:where(R)` plus a filler worth one pseudo-class, the
 *   specificity `:scope` has;
 * - group rules (`@media`, `@supports`, …) inside or around a block are kept,
 *   and anything else in a block, `@keyframes` included, is copied unchanged.
 *
 * Coming last stands in for scope proximity, which the cascade weighs after
 * specificity and before order: a scoped rule beats an unscoped one of equal
 * specificity wherever either appears (checked in Chrome).
 *
 * Not reproduced: proximity between different scoping roots, and blocks with
 * a `to (…)` limit or no prelude, which stay dropped. `:where()` and `:is()`
 * need Chromium 88.
 */

const SCOPE_PSEUDO_CLASS_SPECIFICITY = ':is(:root, :not(:root))';
const GROUP_RULE =
  /^(?:container|document|layer|media|starting-style|supports)$/i;

function skipComment(css: string, start: number): number {
  const end = css.indexOf('*/', start + 2);
  return end === -1 ? css.length : end + 2;
}

function skipString(css: string, start: number): number {
  const quote = css[start];
  let i = start + 1;
  while (i < css.length && css[i] !== quote) {
    i += css[i] === '\\' ? 2 : 1;
  }
  return i + 1;
}

/** Index of the `{` or `;` that ends the prelude starting at `start`. */
function findPreludeEnd(css: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < css.length) {
    const char = css[i];
    if (char === '/' && css[i + 1] === '*') {
      i = skipComment(css, i);
      continue;
    }
    if (char === '"' || char === "'") {
      i = skipString(css, i);
      continue;
    }
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (depth === 0 && (char === '{' || char === ';')) return i;
    i += 1;
  }
  return css.length;
}

/** Index of the `}` matching the `{` at `open`. */
function findBlockEnd(css: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < css.length) {
    const char = css[i];
    if (char === '/' && css[i + 1] === '*') {
      i = skipComment(css, i);
      continue;
    }
    if (char === '"' || char === "'") {
      i = skipString(css, i);
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return css.length;
}

/** Splits at commas outside parentheses, brackets and strings. */
function splitSelectorList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  let i = 0;
  while (i < list.length) {
    const char = list[i];
    if (char === '"' || char === "'") {
      i = skipString(list, i);
      continue;
    }
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(list.slice(from, i));
      from = i + 1;
    }
    i += 1;
  }
  parts.push(list.slice(from));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Replaces `:scope` outside strings and attribute selectors. */
function replaceScopePseudo(selector: string, replacement: string) {
  let out = '';
  let found = false;
  let brackets = 0;
  let i = 0;
  while (i < selector.length) {
    const char = selector[i];
    if (char === '"' || char === "'") {
      const end = skipString(selector, i);
      out += selector.slice(i, end);
      i = end;
      continue;
    }
    if (char === '[') brackets += 1;
    else if (char === ']') brackets -= 1;
    if (
      brackets === 0 &&
      selector.startsWith(':scope', i) &&
      !/[\w-]/.test(selector[i + 6] ?? '')
    ) {
      out += replacement;
      found = true;
      i += 6;
      continue;
    }
    out += char;
    i += 1;
  }
  return { selector: out, found };
}

function scopeSelectorList(list: string, root: string): string {
  const where = `:where(${root})`;
  return splitSelectorList(list)
    .map((selector) => {
      const replaced = replaceScopePseudo(
        selector,
        `${where}${SCOPE_PSEUDO_CLASS_SPECIFICITY}`,
      );
      return replaced.found ? replaced.selector : `${where} ${selector}`;
    })
    .join(', ');
}

/** The body of one `@scope (R)` block, as plain rules. */
function flattenScopeBody(body: string, root: string): string {
  let out = '';
  let i = 0;
  while (i < body.length) {
    if (/\s/.test(body[i])) {
      out += body[i];
      i += 1;
      continue;
    }
    if (body.startsWith('/*', i)) {
      const end = skipComment(body, i);
      out += body.slice(i, end);
      i = end;
      continue;
    }
    const preludeEnd = findPreludeEnd(body, i);
    if (body[preludeEnd] !== '{') {
      out += body.slice(i, preludeEnd + 1);
      i = preludeEnd + 1;
      continue;
    }
    const close = findBlockEnd(body, preludeEnd);
    const prelude = body.slice(i, preludeEnd);
    const inner = body.slice(preludeEnd + 1, close);
    const atRule = /^@([\w-]+)/.exec(prelude);
    if (atRule) {
      const nested = GROUP_RULE.test(atRule[1])
        ? flattenScopeBody(inner, root)
        : inner;
      out += `${prelude}{${nested}}`;
    } else {
      const gap = /\s*$/.exec(prelude)?.[0] ?? '';
      out += `${scopeSelectorList(prelude, root)}${gap}{${inner}}`;
    }
    i = close + 1;
  }
  return out;
}

/** The root selector of `(R)`, or null for a limit, no prelude, or anything else. */
function parseScopeRoot(prelude: string): string | null {
  const trimmed = prelude.trim();
  if (!trimmed.startsWith('(')) return null;
  let depth = 0;
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] === '(') depth += 1;
    else if (trimmed[i] === ')') {
      depth -= 1;
      if (depth === 0) {
        if (trimmed.slice(i + 1).trim()) return null;
        const root = trimmed.slice(1, i).trim();
        return root || null;
      }
    }
  }
  return null;
}

/**
 * The rules of every `@scope (R) { … }` block in `css`, as plain rules inside
 * the group rules that contain them. Everything outside the blocks is left
 * out: an engine that drops the blocks still applies it where it is.
 */
export function extractScopedRules(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (/\s/.test(css[i])) {
      i += 1;
      continue;
    }
    if (css.startsWith('/*', i)) {
      i = skipComment(css, i);
      continue;
    }
    const preludeEnd = findPreludeEnd(css, i);
    if (css[preludeEnd] !== '{') {
      i = preludeEnd + 1;
      continue;
    }
    const close = findBlockEnd(css, preludeEnd);
    const prelude = css.slice(i, preludeEnd);
    const inner = css.slice(preludeEnd + 1, close);
    const name = /^@([\w-]+)/.exec(prelude)?.[1];
    if (name?.toLowerCase() === 'scope') {
      const root = parseScopeRoot(prelude.slice('@scope'.length));
      if (root) out += flattenScopeBody(inner, root);
    } else if (name && GROUP_RULE.test(name)) {
      const nested = extractScopedRules(inner);
      if (nested.trim()) out += `${prelude}{${nested}}`;
    }
    i = close + 1;
  }
  return out;
}

/** A `<style>` resolves `url()` against the page, a `<link>` against itself. */
function absolutizeUrls(css: string, base: string): string {
  return css.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/g,
    (match, quote: string, url: string) => {
      if (/^(?:[a-z][\w+.-]*:|\/|#)/i.test(url)) return match;
      return `url(${quote}${new URL(url, base).href}${quote})`;
    },
  );
}

const SHEET_SELECTOR = 'link[rel~="stylesheet"], style';
const RESTORE_WAIT_MS = 1500;

async function readScopedRules(
  node: Element,
  view: Window & typeof globalThis,
): Promise<string> {
  if (node instanceof view.HTMLStyleElement) {
    return extractScopedRules(node.textContent ?? '');
  }
  if (!(node instanceof view.HTMLLinkElement) || !node.href) return '';
  const response = await view.fetch(node.href);
  if (!response.ok) return '';
  const rules = extractScopedRules(await response.text());
  if (!rules.trim()) return '';
  const css = absolutizeUrls(rules, node.href);
  return node.media && node.media !== 'all'
    ? `@media ${node.media}{${css}}`
    : css;
}

/**
 * Adds the scoped rules of every stylesheet in `doc`, and of each one added
 * to `<head>` later, as one `<style>` kept after them all. A sheet that
 * cannot be fetched contributes nothing.
 */
export async function installCssScopeFallback(doc: Document): Promise<void> {
  const view = doc.defaultView as (Window & typeof globalThis) | null;
  // One per document: two would keep moving after each other without end, and
  // a hot reload or a test that re-evaluates the entry lands here again.
  if (!view || doc.querySelector('style[data-css-scope-fallback]')) return;
  const fallback = doc.createElement('style');
  fallback.dataset.cssScopeFallback = '';
  doc.head.append(fallback);
  const slots: string[] = [];
  const pending: Promise<void>[] = [];
  const seen = new WeakSet<Element>();

  // Rewriting or moving the element re-parses it, so both happen only when
  // something changed.
  const publish = () => {
    const text = slots.filter(Boolean).join('\n');
    if (fallback.textContent !== text) fallback.textContent = text;
    const sheets = doc.head.querySelectorAll(SHEET_SELECTOR);
    if (sheets[sheets.length - 1] !== fallback) doc.head.append(fallback);
  };
  const visit = (node: Element) => {
    if (node === fallback || seen.has(node)) return;
    seen.add(node);
    // One slot per sheet in discovery order, so a slow fetch cannot swap
    // the order of two sheets' rules.
    const slot = slots.push('') - 1;
    pending.push(
      readScopedRules(node, view)
        .then(
          (css) => {
            slots[slot] = css;
          },
          () => {
            // Nothing to recover: the sheet's blocks stay dropped, as they
            // were before the fallback existed.
          },
        )
        .then(publish),
    );
  };

  new view.MutationObserver((records) => {
    let sheetAdded = false;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (
          node instanceof view.Element &&
          node !== fallback &&
          node.matches(SHEET_SELECTOR)
        ) {
          visit(node);
          sheetAdded = true;
        }
      }
    }
    if (sheetAdded) publish();
  }).observe(doc.head, { childList: true });
  for (const node of doc.querySelectorAll(SHEET_SELECTOR)) visit(node);
  await Promise.all(pending);
}

/**
 * Installs the fallback and settles once the rules are in place, or after
 * `waitMs` if a fetch stalls: the boot goes on without them, and they still
 * apply when they arrive.
 */
export function restoreScopedRules(
  doc: Document,
  waitMs = RESTORE_WAIT_MS,
): Promise<void> {
  return Promise.race([
    installCssScopeFallback(doc),
    new Promise<void>((resolve) => setTimeout(resolve, waitMs)),
  ]);
}
