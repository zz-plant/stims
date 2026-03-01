const getThemeController = () => {
  if (window.__stimsTheme) {
    return window.__stimsTheme;
  }

  const resolveThemePreference = () => {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  };

  const applyTheme = (theme, persist = false) => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
    } else {
      root.classList.remove('light');
    }
    if (persist) {
      localStorage.setItem('theme', theme);
    }
  };

  return { resolveThemePreference, applyTheme };
};

export function setupDarkModeToggle(themeToggleId = 'theme-toggle') {
  const btn = document.getElementById(themeToggleId);
  if (!btn) return;

  const { resolveThemePreference, applyTheme } = getThemeController();
  let theme = resolveThemePreference();

  const label = btn.querySelector('[data-theme-label]');
  const icon = btn.querySelector('.theme-toggle__icon');
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)');

  const runViewTransition = (action) => {
    const doc = btn.ownerDocument;
    if (
      !doc ||
      typeof doc.startViewTransition !== 'function' ||
      prefersReducedMotion?.matches
    ) {
      action();
      return;
    }
    doc.startViewTransition(() => {
      action();
    });
  };

  const updateButtonState = () => {
    const isDark = theme === 'dark';
    const labelText = isDark ? 'Light mode' : 'Dark mode';
    if (label) {
      label.textContent = labelText;
    } else {
      btn.textContent = labelText;
    }
    if (icon) {
      icon.textContent = isDark ? '☀️' : '🌙';
    }
    btn.setAttribute('aria-pressed', String(isDark));
    btn.setAttribute(
      'aria-label',
      isDark ? 'Switch to light mode' : 'Switch to dark mode',
    );
  };

  applyTheme(theme);
  updateButtonState();

  btn.addEventListener('click', () => {
    runViewTransition(() => {
      theme = theme === 'dark' ? 'light' : 'dark';
      applyTheme(theme, true);
      updateButtonState();
    });
  });
}
