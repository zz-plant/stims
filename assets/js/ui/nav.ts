export interface NavOptions {
  mode: 'library' | 'toy';
  title?: string;
  slug?: string;
  onBack?: () => void;
  rendererStatus?: {
    backend: 'webgl' | 'webgpu';
    fallbackReason?: string | null;
    shouldRetryWebGPU?: boolean;
    triedWebGPU?: boolean;
    onRetry?: () => void;
  } | null;
}

export function initNavigation(container: HTMLElement, options: NavOptions) {
  const doc = container.ownerDocument;

  if (options.mode === 'library') {
    renderLibraryNav(container, doc);
  } else {
    renderToyNav(container, doc, options);
  }

  setupThemeToggle(container);
}

function renderLibraryNav(container: HTMLElement, _doc: Document) {
  container.innerHTML = `
    <nav class="top-nav" data-top-nav>
      <div class="brand">
        <span class="brand-mark"></span>
        <div class="brand-copy">
          <p class="eyebrow">Stim Lab</p>
          <p class="brand-title">Webtoy Library ✦</p>
        </div>
      </div>
      <div class="nav-actions">
        <a class="nav-link" href="#toy-list">Library</a>
        <a class="nav-link" href="https://github.com/zz-plant/stims" target="_blank" rel="noopener noreferrer">GitHub</a>
        <button id="theme-toggle" class="theme-toggle" aria-pressed="false" aria-label="Switch to dark mode">
          <span class="theme-toggle__icon" aria-hidden="true">🌙</span>
          <span class="theme-toggle__label" data-theme-label>Dark mode</span>
        </button>
      </div>
    </nav>
  `;
}

function renderToyNav(
  container: HTMLElement,
  doc: Document,
  options: NavOptions,
) {
  container.className = 'active-toy-nav';
  container.innerHTML = `
    <div class="active-toy-nav__content">
      <p class="active-toy-nav__eyebrow">Now playing</p>
      <p class="active-toy-nav__title">${options.title ?? 'Web toy'}</p>
      <p class="active-toy-nav__hint">Press Esc or use Back to return to the library.</p>
      ${options.slug ? `<span class="active-toy-nav__pill">${options.slug}</span>` : ''}
    </div>
    <div class="active-toy-nav__actions">
      <div class="renderer-status-container"></div>
      <button type="button" class="toy-nav__back" data-back-to-library="true">
        <span aria-hidden="true">←</span><span>Back to library</span>
      </button>
    </div>
  `;

  if (options.rendererStatus) {
    const statusContainer = container.querySelector(
      '.renderer-status-container',
    );
    if (statusContainer) {
      renderRendererStatus(
        statusContainer as HTMLElement,
        doc,
        options.rendererStatus,
      );
    }
  }

  const backBtn = container.querySelector('.toy-nav__back');
  backBtn?.addEventListener('click', () => options.onBack?.());
}

function renderRendererStatus(
  container: HTMLElement,
  _doc: Document,
  status: NonNullable<NavOptions['rendererStatus']>,
) {
  const fallback = status.backend !== 'webgpu';
  const pillClass = fallback
    ? 'renderer-pill--fallback'
    : 'renderer-pill--success';

  container.innerHTML = `
    <div class="renderer-status">
      <span class="renderer-pill ${pillClass}" title="${status.fallbackReason ?? (fallback ? 'WebGPU unavailable, using WebGL.' : 'WebGPU renderer active.')}">
        ${fallback ? 'WebGL fallback' : 'WebGPU'}
      </span>
      ${status.fallbackReason ? `<small class="renderer-pill__detail">${status.fallbackReason}</small>` : ''}
      ${status.shouldRetryWebGPU ? `<button type="button" class="renderer-pill__retry">${status.triedWebGPU ? 'Retry WebGPU' : 'Try WebGPU'}</button>` : ''}
    </div>
  `;

  const retryBtn = container.querySelector('.renderer-pill__retry');
  retryBtn?.addEventListener('click', () => status.onRetry?.());
}

function setupThemeToggle(container: HTMLElement) {
  const toggle = container.querySelector('#theme-toggle');
  if (!toggle) return;

  const label = toggle.querySelector('[data-theme-label]');
  const icon = toggle.querySelector('.theme-toggle__icon');

  const updateUI = (theme: string) => {
    const isDark = theme === 'dark';
    toggle.setAttribute('aria-pressed', String(isDark));
    if (label) label.textContent = isDark ? 'Light mode' : 'Dark mode';
    if (icon) icon.textContent = isDark ? '☀️' : '🌙';
  };

  // Initial state
  const currentTheme = document.documentElement.classList.contains('light')
    ? 'light'
    : 'dark';
  updateUI(currentTheme);

  toggle.addEventListener('click', () => {
    const isLight = document.documentElement.classList.contains('light');
    const nextTheme = isLight ? 'dark' : 'light';

    // Use the global helper if available
    if (window.__stimsTheme) {
      window.__stimsTheme.applyTheme(nextTheme, true);
    } else {
      if (nextTheme === 'light') {
        document.documentElement.classList.add('light');
      } else {
        document.documentElement.classList.remove('light');
      }
      localStorage.setItem('theme', nextTheme);
    }

    updateUI(nextTheme);
  });
}
