import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { dismissLoadingScreen } from '../../src/js/frontend/loading-screen.ts';
import { NewHomePage } from '../../src/js/frontend/NewHomePage.tsx';
import { renderWorkspace } from '../frontend-harness.tsx';

test('static loading screen survives React root replacement', async () => {
  const source = await readFile('index.html', 'utf8');
  const document = new DOMParser().parseFromString(
    source.replace(/<link\b[^>]*>/g, ''),
    'text/html',
  );
  const loading = document.getElementById('stims-loading');
  const app = document.getElementById('app');

  expect(loading).not.toBeNull();
  expect(app).not.toBeNull();
  expect(loading?.parentElement).toBe(document.body);
  expect(app?.parentElement).toBe(document.body);
  expect(loading?.nextElementSibling).toBe(app);
});

test('the app shell dismisses the loading screen through its exit transition', async () => {
  const [html, app] = await Promise.all([
    readFile('index.html', 'utf8'),
    readFile('src/js/frontend/App.tsx', 'utf8'),
  ]);

  expect(html).toContain('.stims-loading--leaving');
  expect(app).toContain(
    "import { dismissLoadingScreen } from './loading-screen.ts';",
  );
  expect(app).toContain('dismissLoadingScreen();');
  expect(app).not.toContain("document.getElementById('stims-loading')");
});

test('loading screen remains for the crossfade and is removed when opacity finishes', () => {
  document.body.innerHTML = '<div id="stims-loading"></div>';
  const loading = document.getElementById('stims-loading');
  expect(loading).not.toBeNull();

  dismissLoadingScreen();

  expect(loading?.classList.contains('stims-loading--leaving')).toBe(true);
  expect(loading?.getAttribute('aria-hidden')).toBe('true');
  expect(loading?.isConnected).toBe(true);

  const transitionEnd = new Event('transitionend');
  Object.defineProperty(transitionEnd, 'propertyName', { value: 'opacity' });
  loading?.dispatchEvent(transitionEnd);

  expect(loading?.isConnected).toBe(false);
});

test('reduced motion removes the loading screen immediately', () => {
  document.body.innerHTML = '<div id="stims-loading"></div>';
  const loading = document.getElementById('stims-loading');
  const matchMedia = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: true }),
  });

  try {
    dismissLoadingScreen();
    expect(loading?.isConnected).toBe(false);
  } finally {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: matchMedia,
    });
  }
});

/**
 * The cover paints the first-visit header from HTML so the page's largest
 * text does not wait for the app bundle, then crossfades into the React page
 * drawing the same lines. Different words in the two would show as a swap
 * mid-fade, so the copy is held together here: the real NewHomePage, as a
 * first visit gets it, against the shipped cover.
 */
test('the boot cover previews the first-visit header word for word', async () => {
  const source = await readFile('index.html', 'utf8');
  const cover = new DOMParser().parseFromString(
    source.replace(/<link\b[^>]*>/g, ''),
    'text/html',
  );
  const coverText = (selector: string) =>
    cover.querySelector(selector)?.textContent?.trim() ?? null;

  const rendered = renderWorkspace(createElement(NewHomePage));
  try {
    const launchText = (selector: string) =>
      rendered.container.querySelector(selector)?.textContent?.trim() ?? null;

    expect(launchText('h1')).toBe('A music visualizer you can open up');
    expect(coverText('.stims-loading__brand')).toBe(
      launchText('.stims-shell__launch-nameplate'),
    );
    expect(coverText('.stims-loading__title')).toBe(launchText('h1'));
    expect(coverText('.stims-loading__tagline')).toBe(
      launchText('.stims-shell__launch-tagline'),
    );
  } finally {
    rendered.dispose();
  }
});

/** The shipped pre-paint script that picks the cover variant. */
function coverVariantScript(html: string): string {
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1] as string)
    .find((body) => body.includes('stims-cover-minimal'));
  if (!script) throw new Error('cover variant script not found in index.html');
  return script;
}

/** Runs the real script for one arrival; true when it kept the first-visit copy. */
function coverShowsFirstVisitCopy(
  script: string,
  url: string,
  storage: Record<string, string> | 'throws' = {},
): boolean {
  const { pathname, search } = new URL(url, 'https://toil.fyi');
  const classes = new Set<string>();
  const localStorageStub = {
    getItem: (key: string) => {
      if (storage === 'throws') throw new Error('storage blocked');
      return storage[key] ?? null;
    },
  };
  new Function('window', 'document', 'localStorage', script)(
    { location: { pathname, search } },
    { documentElement: { classList: { add: (c: string) => classes.add(c) } } },
    localStorageStub,
  );
  return !classes.has('stims-cover-minimal');
}

test('the cover keeps its first-visit copy only where the app shows it', async () => {
  const script = coverVariantScript(await readFile('index.html', 'utf8'));

  // NewHomePage's first-visit header: no arrival preset, no saved session,
  // no hub route. Flags that only open a panel or change the renderer keep it.
  expect(coverShowsFirstVisitCopy(script, '/')).toBe(true);
  expect(coverShowsFirstVisitCopy(script, '/?tool=browse')).toBe(true);
  expect(coverShowsFirstVisitCopy(script, '/?agent=true&renderer=webgl')).toBe(
    true,
  );

  // Every other launch opens on a different header: the preset's name, a
  // returning visitor's card, a hub heading, or no launch page at all.
  expect(coverShowsFirstVisitCopy(script, '/?preset=geiss-casino')).toBe(false);
  expect(coverShowsFirstVisitCopy(script, '/discover/fractal')).toBe(false);
  expect(coverShowsFirstVisitCopy(script, '/author/geiss')).toBe(false);
  expect(coverShowsFirstVisitCopy(script, '/?embedded=true')).toBe(false);
  expect(coverShowsFirstVisitCopy(script, '/?preview=true')).toBe(false);
  expect(
    coverShowsFirstVisitCopy(script, '/', {
      'stims:last-session': '{"presetId":"geiss-casino","source":"demo"}',
    }),
  ).toBe(false);
  // Unreadable storage might be hiding a saved session: stay generic.
  expect(coverShowsFirstVisitCopy(script, '/', 'throws')).toBe(false);
});
