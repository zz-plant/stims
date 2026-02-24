import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { initNavigation } from '../assets/js/ui/nav.ts';

type MatchMediaListener = (event: MediaQueryListEvent) => void;

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

describe('library navigation interactions', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    document.body.innerHTML = '<div id="nav"></div>';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    window.matchMedia = originalMatchMedia;
  });

  test('Escape closes mobile menu and restores focus to menu toggle', () => {
    const { matchMedia } = createMatchMediaStub();
    window.matchMedia = matchMedia;

    const container = document.getElementById('nav') as HTMLElement;
    initNavigation(container, { mode: 'library' });

    const toggle = container.querySelector('.nav-toggle') as HTMLButtonElement;
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    document.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Escape' }),
    );

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });

  test('menu toggle exposes stateful aria-label text on mobile', () => {
    const { matchMedia } = createMatchMediaStub();
    window.matchMedia = matchMedia;

    const container = document.getElementById('nav') as HTMLElement;
    initNavigation(container, { mode: 'library' });

    const toggle = container.querySelector('.nav-toggle') as HTMLButtonElement;
    const actions = container.querySelector('#nav-actions') as HTMLElement;

    expect(toggle.getAttribute('aria-label')).toBe('Open navigation menu');
    expect(actions.getAttribute('aria-hidden')).toBe('true');
    expect(actions.hasAttribute('inert')).toBeTrue();

    toggle.click();
    expect(toggle.getAttribute('aria-label')).toBe('Close navigation menu');
    expect(actions.getAttribute('aria-hidden')).toBe('false');
    expect(actions.hasAttribute('inert')).toBeFalse();
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

  test('re-rendering library nav cleans up previous media-query listener', () => {
    const { matchMedia, getListenerCount } = createMatchMediaStub();
    window.matchMedia = matchMedia;

    const container = document.getElementById('nav') as HTMLElement;
    initNavigation(container, { mode: 'library' });
    expect(getListenerCount()).toBe(1);

    initNavigation(container, { mode: 'library' });
    expect(getListenerCount()).toBe(1);
  });
});

describe('toy navigation visibility states', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    document.body.innerHTML = '<div id="nav"></div>';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    window.matchMedia = originalMatchMedia;
  });

  test('mobile view keeps primary actions visible while extra controls are collapsed by default', () => {
    const { matchMedia } = createMatchMediaStub();
    window.matchMedia = matchMedia;

    const container = document.getElementById('nav') as HTMLElement;
    initNavigation(container, { mode: 'toy', title: 'Spectrum Bloom' });

    const actions = container.querySelector('#toy-nav-actions') as HTMLElement;
    const toggle = container.querySelector(
      '[data-toy-actions-toggle="true"]',
    ) as HTMLButtonElement;
    const primary = container.querySelector('.active-toy-nav__actions-primary');
    const secondary = container.querySelector(
      '.active-toy-nav__actions-secondary',
    );

    expect(actions.dataset.toyActionsExpanded).toBe('false');
    expect(toggle.textContent).toBe('More controls');
    expect(primary).toBeTruthy();
    expect(secondary).toBeTruthy();
    expect(document.documentElement.dataset.toyControlsExpanded).toBe('false');
  });
});
