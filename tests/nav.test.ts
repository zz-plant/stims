import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { initNavigation } from '../assets/js/ui/nav.ts';

type MatchMediaListener = (event: MediaQueryListEvent) => void;
type NavCleanupContainer = HTMLElement & {
  __toyNavOffsetCleanup?: () => void;
  __toyNavChromeCleanup?: () => void;
  __toyNavDetachCleanup?: () => void;
  __libraryNavCleanup?: () => void;
};

function createMatchMediaStub(matches = true) {
  const listeners = new Set<MatchMediaListener>();
  const mediaQueryList: MediaQueryList = {
    matches,
    media: '(max-width: 520px)',
    onchange: null,
    addEventListener: (
      _type: string,
      listener: EventListenerOrEventListenerObject,
    ) => {
      if (typeof listener === 'function') {
        listeners.add(listener as MatchMediaListener);
      }
    },
    removeEventListener: (
      _type: string,
      listener: EventListenerOrEventListenerObject,
    ) => {
      if (typeof listener === 'function') {
        listeners.delete(listener as MatchMediaListener);
      }
    },
    addListener: (
      listener: (this: MediaQueryList, event: MediaQueryListEvent) => void,
    ) => {
      listeners.add(listener as MatchMediaListener);
    },
    removeListener: (
      listener: (this: MediaQueryList, event: MediaQueryListEvent) => void,
    ) => {
      listeners.delete(listener as MatchMediaListener);
    },
    dispatchEvent: () => true,
  };

  return {
    matchMedia: () => mediaQueryList,
    getListenerCount: () => listeners.size,
  };
}

function readTrimmedText(node: Element | null) {
  return node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('site navigation interactions', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    document.body.innerHTML = '<div id="nav"></div>';
  });

  afterEach(() => {
    const container = document.getElementById(
      'nav',
    ) as NavCleanupContainer | null;
    container?.__toyNavOffsetCleanup?.();
    container?.__toyNavChromeCleanup?.();
    container?.__toyNavDetachCleanup?.();
    container?.__libraryNavCleanup?.();
    delete document.documentElement.dataset.sessionDisplayMode;
    delete document.documentElement.dataset.sessionChrome;
    delete document.documentElement.dataset.toyControlsExpanded;
    document.documentElement.classList.remove('light');
    document.body.innerHTML = '';
    window.matchMedia = originalMatchMedia;
  });

  test('mobile fallback toggle updates navigation state and aria attributes without document listeners', () => {
    const { matchMedia } = createMatchMediaStub();
    window.matchMedia = matchMedia;

    const container = document.getElementById('nav') as HTMLElement;
    initNavigation(container, { mode: 'library' });

    const toggle = container.querySelector('.nav-toggle') as HTMLButtonElement;
    const actions = container.querySelector('#nav-actions') as HTMLElement;
    const readToggleIcon = () =>
      toggle.querySelector('svg')?.getAttribute('data-icon');

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Open navigation menu');
    expect(readToggleIcon()).toBe('menu');
    expect(actions.getAttribute('aria-hidden')).toBe('true');
    expect(actions.hasAttribute('inert')).toBeTrue();

    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Close navigation menu');
    expect(readToggleIcon()).toBe('close');
    expect(actions.getAttribute('aria-hidden')).toBe('false');
    expect(actions.hasAttribute('inert')).toBeFalse();

    document.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Escape' }),
    );

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(actions.getAttribute('aria-hidden')).toBe('false');
  });

  test('desktop viewport keeps nav actions visible and interactive', () => {
    const { matchMedia } = createMatchMediaStub(false);
    window.matchMedia = matchMedia;

    const container = document.getElementById('nav') as HTMLElement;
    initNavigation(container, { mode: 'library' });

    const toggle = container.querySelector('.nav-toggle') as HTMLButtonElement;
    const actions = container.querySelector('#nav-actions') as HTMLElement;

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(actions.getAttribute('aria-hidden')).toBe('false');
    expect(actions.hasAttribute('inert')).toBeFalse();
  });

  test('site nav exposes the homepage sections plus launchpad in the main link set', () => {
    const { matchMedia } = createMatchMediaStub(false);
    window.matchMedia = matchMedia;

    const container = document.getElementById('nav') as HTMLElement;
    initNavigation(container, { mode: 'library' });

    const hrefs = Array.from(
      container.querySelectorAll('.nav-section--primary .nav-link'),
    ).map((link) => (link as HTMLAnchorElement).getAttribute('href'));

    expect(hrefs).toContain('#experience');
    expect(hrefs).toContain('#presets');
    expect(hrefs).toContain('#structure');
    expect(hrefs).toContain('https://github.com/zz-plant/stims');
    expect(hrefs).toHaveLength(4);

    const utilityHrefs = Array.from(
      container.querySelectorAll('.nav-section--utilities .nav-link'),
    ).map((link) => (link as HTMLAnchorElement).getAttribute('href'));

    expect(utilityHrefs).toContain('/milkdrop/');
  });

  test('site nav accepts launch-route section links and a custom utility action', () => {
    const { matchMedia } = createMatchMediaStub(false);
    window.matchMedia = matchMedia;

    const container = document.getElementById('nav') as HTMLElement;
    initNavigation(container, {
      mode: 'library',
      sectionLinks: [
        { href: '#session-flow', label: 'Flow' },
        { href: '#launch-workspace', label: 'Setup' },
        { href: '#launch-panels', label: 'Controls' },
      ],
      utilityLink: { href: '/', label: 'Back home' },
    });

    const hrefs = Array.from(
      container.querySelectorAll('.nav-section--primary .nav-link'),
    ).map((link) => (link as HTMLAnchorElement).getAttribute('href'));

    expect(hrefs).toContain('#session-flow');
    expect(hrefs).toContain('#launch-workspace');
    expect(hrefs).toContain('#launch-panels');
    expect(hrefs).toContain('https://github.com/zz-plant/stims');

    const utilityLinks = Array.from(
      container.querySelectorAll('.nav-section--utilities .nav-link'),
    ).map((link) => ({
      href: (link as HTMLAnchorElement).getAttribute('href'),
      label: link.textContent?.trim(),
    }));

    expect(utilityLinks).toContainEqual({ href: '/', label: 'Back home' });
  });

  test('re-rendering site nav cleans up previous media-query listener', () => {
    const { matchMedia, getListenerCount } = createMatchMediaStub();
    window.matchMedia = matchMedia;

    const container = document.getElementById('nav') as HTMLElement;
    initNavigation(container, { mode: 'library' });
    expect(getListenerCount()).toBe(1);

    initNavigation(container, { mode: 'library' });
    expect(getListenerCount()).toBe(1);
  });

  test('theme toggle swaps vendored icons with the theme state', () => {
    const { matchMedia } = createMatchMediaStub(false);
    window.matchMedia = matchMedia;
    document.documentElement.classList.add('light');

    const container = document.getElementById('nav') as HTMLElement;
    initNavigation(container, { mode: 'library' });

    const toggle = container.querySelector(
      '#theme-toggle',
    ) as HTMLButtonElement;
    const readThemeIcon = () =>
      toggle.querySelector('svg')?.getAttribute('data-icon');
    const themeLabel = toggle.querySelector('[data-theme-label]');

    expect(readTrimmedText(themeLabel)).toBe('Dark mode');
    expect(readThemeIcon()).toBe('moon');
    expect(toggle.getAttribute('aria-label')).toBe('Switch to dark mode');

    toggle.click();

    expect(readTrimmedText(themeLabel)).toBe('Light mode');
    expect(readThemeIcon()).toBe('sun');
    expect(toggle.getAttribute('aria-label')).toBe('Switch to light mode');
  });
});

describe('toy navigation visibility states', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    document.body.innerHTML = '<div id="nav"></div>';
  });

  afterEach(() => {
    const container = document.getElementById(
      'nav',
    ) as NavCleanupContainer | null;
    container?.__toyNavOffsetCleanup?.();
    container?.__toyNavChromeCleanup?.();
    container?.__toyNavDetachCleanup?.();
    container?.__libraryNavCleanup?.();
    delete document.documentElement.dataset.sessionDisplayMode;
    delete document.documentElement.dataset.sessionChrome;
    delete document.documentElement.dataset.toyControlsExpanded;
    document.documentElement.classList.remove('light');
    document.body.innerHTML = '';
    window.matchMedia = originalMatchMedia;
  });

  test('mobile view starts with the toy action drawer collapsed', () => {
    const { matchMedia } = createMatchMediaStub();
    window.matchMedia = matchMedia;

    const container = document.getElementById('nav') as HTMLElement;
    initNavigation(container, { mode: 'toy', title: 'Spectrum Bloom' });

    const actions = container.querySelector('#toy-nav-actions') as HTMLElement;
    const secondary = container.querySelector(
      '#toy-nav-secondary-actions',
    ) as HTMLElement;
    const toggle = container.querySelector(
      '[data-toy-actions-toggle="true"]',
    ) as HTMLButtonElement;
    const primary = container.querySelector('.active-toy-nav__actions-primary');
    const toggleLabel = toggle.querySelector('.toy-nav__button-label');

    expect(actions.dataset.toyActionsExpanded).toBe('false');
    expect(actions.hidden).toBe(false);
    expect(actions.getAttribute('aria-hidden')).toBeNull();
    expect(actions.hasAttribute('inert')).toBe(false);
    expect(secondary.hidden).toBe(true);
    expect(secondary.getAttribute('aria-hidden')).toBe('true');
    expect(secondary.hasAttribute('inert')).toBe(true);
    expect(readTrimmedText(toggleLabel)).toBe('Controls');
    expect(primary).toBeTruthy();
    expect(secondary).toBeTruthy();
    expect(document.documentElement.dataset.toyControlsExpanded).toBe('false');
  });

  test('mobile toy nav toggle updates its label as the drawer opens', () => {
    const { matchMedia } = createMatchMediaStub();
    window.matchMedia = matchMedia;

    const container = document.getElementById('nav') as HTMLElement;
    initNavigation(container, { mode: 'toy', title: 'Spectrum Bloom' });

    const toggle = container.querySelector(
      '[data-toy-actions-toggle="true"]',
    ) as HTMLButtonElement;
    const toggleLabel = toggle.querySelector('.toy-nav__button-label');

    toggle.click();

    expect(readTrimmedText(toggleLabel)).toBe('Hide controls');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe(
      'toy-nav-secondary-actions',
    );
    expect(
      (container.querySelector('#toy-nav-secondary-actions') as HTMLElement)
        .hidden,
    ).toBe(false);
  });

  test('toy nav keeps the default surface focused on the title and controls', () => {
    const { matchMedia } = createMatchMediaStub();
    window.matchMedia = matchMedia;

    const container = document.getElementById('nav') as HTMLElement;
    initNavigation(container, {
      mode: 'toy',
      title: 'Spectrum Bloom',
      slug: 'spectrum-bloom',
    });

    expect(container.querySelector('.active-toy-nav__eyebrow')).toBeNull();
    expect(container.querySelector('.active-toy-nav__hint')).toBeNull();
    expect(container.querySelector('.active-toy-nav__pill')).toBeNull();
    expect(container.textContent).toContain('Spectrum Bloom');
    expect(container.textContent).toContain('Controls');
  });

  test('immersive sessions auto-hide chrome until interaction reveals it again', async () => {
    const { matchMedia } = createMatchMediaStub();
    window.matchMedia = matchMedia;

    const container = document.getElementById('nav') as HTMLElement;
    document.documentElement.dataset.sessionDisplayMode = 'immersive';
    document.documentElement.dataset.sessionChrome = 'visible';
    initNavigation(container, { mode: 'toy', title: 'Spectrum Bloom' });

    await new Promise((resolve) => setTimeout(resolve, 2300));

    expect(document.documentElement.dataset.sessionChrome).toBe('hidden');

    document.dispatchEvent(new window.Event('pointermove'));
    expect(document.documentElement.dataset.sessionChrome).toBe('visible');
  });
});
