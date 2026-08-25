import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { dismissLoadingScreen } from '../../src/js/frontend/loading-screen.ts';

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
