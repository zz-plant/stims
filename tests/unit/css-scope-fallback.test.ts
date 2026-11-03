import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import {
  extractScopedRules,
  installCssScopeFallback,
  restoreScopedRules,
} from '../../src/js/frontend/css-scope-fallback.ts';

const SHELL_DOM = `
  <div class="stims-shell" data-mode="live">
    <div class="item" id="inside"></div>
    <div class="direct" id="child"><div class="direct" id="grandchild"></div></div>
    <div class="b c" id="listed"></div>
    <div class="nested" id="nested"></div>
  </div>
  <div class="item" id="outside"></div>
`;

// The unscoped rules around the blocks decide each property only if the
// fallback keeps @scope's specificity and its win over unscoped rules of
// equal specificity. The expected values were read from Chrome 13x.
const SCOPED_CSS = `
  .stims-shell { visibility: hidden; }
  @scope (.stims-shell) {
    :scope { visibility: visible; display: grid; }
    :scope[data-mode="live"] { color: rgb(1, 2, 3); }
    .item { display: flex; color: rgb(0, 0, 255); }
    > .direct { padding-top: 7px; }
    .a, .b:is(.c, .d) { margin-top: 3px; }
    @media (min-width: 0px) { .nested { margin-left: 5px; } }
    @keyframes spin { from { opacity: 0; } to { opacity: 1; } }
    /* a brace in a comment { */
  }
  .item { color: rgb(255, 0, 0); }
  .stims-shell { display: block; }
  div.item { outline-color: rgb(9, 9, 9); }
  @scope (.stims-shell) { .item { outline-color: rgb(7, 7, 7); } }
`;

/** A page as an engine without @scope sees it: the blocks are gone. */
function pageWithoutScope(css: string) {
  const window = new Window({
    url: 'https://example.test/',
    settings: { disableCSSFileLoading: true },
  });
  const { document } = window;
  document.body.innerHTML = SHELL_DOM;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  // happy-dom applies @scope, so its blocks are deleted from the CSSOM; the
  // text the fallback reads keeps them.
  const sheet = style.sheet;
  if (!sheet) throw new Error('the fixture stylesheet did not parse');
  for (let i = sheet.cssRules.length - 1; i >= 0; i -= 1) {
    if (sheet.cssRules[i].constructor.name === 'CSSScopeRule') {
      sheet.deleteRule(i);
    }
  }
  const computed = (id: string) => {
    const element =
      id === 'root'
        ? document.querySelector('.stims-shell')
        : document.getElementById(id);
    if (!element) throw new Error(`no #${id} in the fixture`);
    return window.getComputedStyle(element);
  };
  return { window, document, computed };
}

describe('installCssScopeFallback', () => {
  test('a page without @scope loses the scoped rules', () => {
    const { computed } = pageWithoutScope(SCOPED_CSS);
    expect(computed('root').display).toBe('block');
    expect(computed('inside').color).toBe('rgb(255, 0, 0)');
  });

  test('restores what Chrome computes with @scope', async () => {
    const { document, computed } = pageWithoutScope(SCOPED_CSS);
    await installCssScopeFallback(document as unknown as Document);

    // `:scope` weighs one pseudo-class and wins ties with unscoped rules
    // before and after the block.
    expect(computed('root').visibility).toBe('visible');
    expect(computed('root').display).toBe('grid');
    expect(computed('root').color).toBe('rgb(1, 2, 3)');

    // A bare scoped selector adds no specificity: it wins the tie with the
    // later unscoped `.item`, loses to the more specific `div.item`, and
    // matches nothing outside the root.
    expect(computed('inside').display).toBe('flex');
    expect(computed('inside').color).toBe('rgb(0, 0, 255)');
    expect(computed('inside').outlineColor).toBe('rgb(9, 9, 9)');
    expect(computed('outside').display).toBe('block');

    expect(computed('child').paddingTop).toBe('7px');
    expect(computed('grandchild').paddingTop).not.toBe('7px');
    expect(computed('listed').marginTop).toBe('3px');
    expect(computed('nested').marginLeft).toBe('5px');
  });

  test('keeps the copies after stylesheets added later', async () => {
    const { window, document, computed } = pageWithoutScope(SCOPED_CSS);
    await installCssScopeFallback(document as unknown as Document);

    const late = document.createElement('style');
    late.textContent =
      '.item { color: rgb(255, 0, 0); } @scope (.stims-shell) { .late { order: 2; } }';
    document.head.append(late);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const sheets = document.head.querySelectorAll('style');
    const fallback = sheets[sheets.length - 1];
    expect(fallback.hasAttribute('data-css-scope-fallback')).toBe(true);
    expect(fallback.textContent).toContain(':where(.stims-shell) .late');
    expect(computed('inside').color).toBe('rgb(0, 0, 255)');
    window.close();
  });

  // Two copies would each keep moving after the other, without end: a shell
  // test that boots app.ts per test hung on exactly this.
  test('installs once per document', async () => {
    const { document, computed } = pageWithoutScope(SCOPED_CSS);
    const doc = document as unknown as Document;
    await Promise.all([
      installCssScopeFallback(doc),
      installCssScopeFallback(doc),
    ]);
    await installCssScopeFallback(doc);

    const late = document.createElement('style');
    late.textContent = '.late { order: 2; }';
    document.head.append(late);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const copies = document.head.querySelectorAll('[data-css-scope-fallback]');
    expect(copies.length).toBe(1);
    expect(document.head.lastElementChild).toBe(copies[0]);
    expect(computed('inside').color).toBe('rgb(0, 0, 255)');
  });

  test('reads linked sheets against their own URL', async () => {
    const window = new Window({
      url: 'https://example.test/',
      settings: { disableCSSFileLoading: true },
    });
    const { document } = window;
    window.fetch = (async () =>
      new window.Response(
        '.plain { order: 1; } @scope (.stims-shell) { .item { background: url(fonts/a.png); } }',
      )) as unknown as typeof window.fetch;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.media = 'screen';
    link.href = 'https://example.test/assets/app.css';
    document.head.append(link);

    await installCssScopeFallback(document as unknown as Document);

    const fallback = document.head.querySelector('[data-css-scope-fallback]');
    expect(fallback?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      '@media screen{ :where(.stims-shell) .item { background: url(https://example.test/assets/fonts/a.png); } }',
    );
  });
});

describe('restoreScopedRules', () => {
  test('a stalled sheet does not hold the boot, and applies when it arrives', async () => {
    const window = new Window({
      url: 'https://example.test/',
      settings: { disableCSSFileLoading: true },
    });
    const { document } = window;
    let arrive: (css: string) => void = () => {};
    const text = new Promise<string>((resolve) => {
      arrive = resolve;
    });
    window.fetch = (async () => ({
      ok: true,
      text: () => text,
    })) as unknown as typeof window.fetch;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://example.test/assets/app.css';
    document.head.append(link);

    await restoreScopedRules(document as unknown as Document, 1);
    const fallback = document.head.querySelector('[data-css-scope-fallback]');
    expect(fallback?.textContent).toBe('');

    arrive('@scope (.stims-shell) { .item { order: 1; } }');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fallback?.textContent).toContain(':where(.stims-shell) .item');
  });
});

describe('extractScopedRules', () => {
  test('keeps keyframes and group rules, drops what it cannot reproduce', () => {
    expect(extractScopedRules(SCOPED_CSS)).toContain(
      '@keyframes spin { from { opacity: 0; } to { opacity: 1; } }',
    );
    expect(
      extractScopedRules('@media (x){.u{order:0}@scope (.s){.a{order:1}}}'),
    ).toBe('@media (x){:where(.s) .a{order:1}}');
    expect(extractScopedRules('@scope (.a) to (.b) { .x { order: 1; } }')).toBe(
      '',
    );
    expect(extractScopedRules('@scope { .x { order: 1; } }')).toBe('');
  });

  test('reads minified output', () => {
    expect(
      extractScopedRules(
        'a{color:red}@scope(.s){.x{order:1}:scope>.y{order:2}}',
      ),
    ).toBe(
      ':where(.s) .x{order:1}:where(.s):is(:root, :not(:root))>.y{order:2}',
    );
  });

  // happy-dom ends a rule at a `}` inside a string, so these are read from
  // the output rather than from computed styles.
  test('reads braces and commas inside strings', () => {
    expect(
      extractScopedRules(
        '@scope (.s) { [data-a="}"], [data-b=","] { order: 1; } }',
      ),
    ).toBe(' :where(.s) [data-a="}"], :where(.s) [data-b=","] { order: 1; } ');
    expect(
      extractScopedRules(
        '@scope (.s) { .q { content: "}"; } .r { order: 2; } }',
      ),
    ).toBe(' :where(.s) .q { content: "}"; } :where(.s) .r { order: 2; } ');
  });
});
