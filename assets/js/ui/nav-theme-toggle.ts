import { replaceIconContents } from './icon-library.ts';

export function setupThemeToggle(container: HTMLElement) {
  const doc = container.ownerDocument;
  const toggle = container.querySelector('#theme-toggle');
  if (!toggle) return;

  const label = toggle.querySelector('[data-theme-label]');
  const icon = toggle.querySelector('.theme-toggle__icon');

  const updateUI = (theme: string) => {
    const isDark = theme === 'dark';
    toggle.setAttribute('aria-pressed', String(isDark));
    toggle.setAttribute(
      'aria-label',
      isDark ? 'Switch to light mode' : 'Switch to dark mode',
    );
    if (label) {
      label.textContent = isDark ? 'Light mode' : 'Dark mode';
    }
    replaceIconContents(icon, isDark ? 'sun' : 'moon', {
      title: isDark ? 'Light mode' : 'Dark mode',
    });
  };

  const root = doc.documentElement;
  const currentTheme = root.classList.contains('light') ? 'light' : 'dark';
  updateUI(currentTheme);

  toggle.addEventListener('click', () => {
    const isLight = root.classList.contains('light');
    const nextTheme = isLight ? 'dark' : 'light';
    const win = doc.defaultView ?? window;

    if (win.__stimsTheme) {
      win.__stimsTheme.applyTheme(nextTheme, true);
    } else {
      if (nextTheme === 'light') {
        root.classList.add('light');
      } else {
        root.classList.remove('light');
      }
      try {
        win.localStorage.setItem('theme', nextTheme);
      } catch (_error) {
        // Ignore storage errors.
      }
    }

    updateUI(nextTheme);
  });
}
