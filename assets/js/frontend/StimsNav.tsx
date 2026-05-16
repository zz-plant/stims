import { useCallback, useState } from 'react';

export function StimsNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleMenu = useCallback(() => setMenuOpen((v) => !v), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <nav
      className="top-nav"
      data-top-nav
      aria-label="Primary"
      data-nav-expanded={String(menuOpen)}
    >
      <div className="brand">
        <span className="brand-mark" />
        <div className="brand-copy">
          <p className="eyebrow">Stims</p>
          <p className="brand-title">Stims</p>
        </div>
      </div>
      <button
        className="nav-toggle"
        type="button"
        aria-expanded={menuOpen}
        aria-controls="nav-actions"
        onClick={toggleMenu}
      >
        <span data-nav-toggle-label>{menuOpen ? 'Close' : 'Menu'}</span>
      </button>
      <div
        className="nav-actions"
        id="nav-actions"
        aria-hidden={!menuOpen}
        inert={!menuOpen}
      >
        <div className="nav-section nav-section--utilities">
          <a
            className="nav-link"
            href="https://github.com/zz-plant/stims"
            target="_blank"
            rel="noopener noreferrer"
            onClick={closeMenu}
          >
            GitHub
          </a>
          <button
            id="theme-toggle"
            className="theme-toggle"
            type="button"
            aria-pressed="false"
            aria-label="Switch to dark mode"
          >
            <span className="theme-toggle__label" data-theme-label>
              Dark mode
            </span>
          </button>
        </div>
      </div>
    </nav>
  );
}
