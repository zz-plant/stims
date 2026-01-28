import {
  exitToyPictureInPicture,
  getToyPictureInPictureVideo,
  isPictureInPictureSupported,
  isToyPictureInPictureActive,
  requestToyPictureInPicture,
} from '../utils/picture-in-picture.ts';

export interface NavOptions {
  mode: 'library' | 'toy';
  title?: string;
  slug?: string;
  onBack?: () => void;
  onShare?: () => void;
  rendererStatus?: {
    backend: 'webgl' | 'webgpu';
    fallbackReason?: string | null;
    shouldRetryWebGPU?: boolean;
    triedWebGPU?: boolean;
    onRetry?: () => void;
  } | null;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (match) => {
    switch (match) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return match;
    }
  });
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
    <nav class="top-nav" data-top-nav aria-label="Primary">
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
        <button id="theme-toggle" class="theme-toggle" type="button" aria-pressed="false" aria-label="Switch to dark mode">
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
  const safeTitle = escapeHtml(options.title ?? 'Web toy');
  const safeSlug = options.slug ? escapeHtml(options.slug) : '';
  container.className = 'active-toy-nav';
  container.innerHTML = `
    <div class="active-toy-nav__content">
      <p class="active-toy-nav__eyebrow">Now playing</p>
      <p class="active-toy-nav__title">${safeTitle}</p>
      <p class="active-toy-nav__hint">Press Esc or use Back to return to the library.</p>
      ${safeSlug ? `<span class="active-toy-nav__pill">${safeSlug}</span>` : ''}
    </div>
    <div class="active-toy-nav__actions">
      <div class="renderer-status-container"></div>
      <div class="toy-nav__pip-wrapper">
        <button type="button" class="toy-nav__pip" data-toy-pip="true" aria-pressed="false">
          Picture in picture
        </button>
        <span class="toy-nav__pip-status" role="status" aria-live="polite"></span>
      </div>
      <div class="toy-nav__share-wrapper">
        <button type="button" class="toy-nav__share" data-share-toy="true">
          Copy share link
        </button>
        <span class="toy-nav__share-status" role="status" aria-live="polite"></span>
      </div>
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

  const shareBtn = container.querySelector('.toy-nav__share');
  const shareStatus = container.querySelector(
    '.toy-nav__share-status',
  ) as HTMLElement | null;

  const showShareStatus = (message: string) => {
    if (!shareStatus) return;
    shareStatus.textContent = message;
    if (!message) return;
    const win = doc.defaultView ?? window;
    win.setTimeout(() => {
      if (shareStatus.textContent === message) {
        shareStatus.textContent = '';
      }
    }, 3200);
  };

  const copyShareLink = async () => {
    const win = doc.defaultView ?? window;
    const url = win.location.href;
    showShareStatus('Copying link…');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const helper = doc.createElement('textarea');
        helper.value = url;
        helper.setAttribute('readonly', 'true');
        helper.style.position = 'fixed';
        helper.style.top = '-1000px';
        doc.body.appendChild(helper);
        helper.select();
        doc.execCommand('copy');
        helper.remove();
      }
      showShareStatus('Share link copied.');
    } catch (_error) {
      showShareStatus('Unable to copy link.');
    }
  };

  shareBtn?.addEventListener('click', () => {
    if (options.onShare) {
      options.onShare();
      return;
    }
    void copyShareLink();
  });

  setupPictureInPictureControls(container, doc);
}

function setupPictureInPictureControls(container: HTMLElement, doc: Document) {
  const pipButton = container.querySelector<HTMLButtonElement>(
    '[data-toy-pip="true"]',
  );
  const pipStatus = container.querySelector<HTMLElement>(
    '.toy-nav__pip-status',
  );

  if (!pipButton || !pipStatus) return;

  const updateButtonState = () => {
    const active = isToyPictureInPictureActive(doc);
    pipButton.setAttribute('aria-pressed', String(active));
    pipButton.textContent = active
      ? 'Exit picture in picture'
      : 'Picture in picture';
  };

  const showStatus = (message: string) => {
    pipStatus.textContent = message;
    if (!message) return;
    const win = doc.defaultView ?? window;
    win.setTimeout(() => {
      if (pipStatus.textContent === message) {
        pipStatus.textContent = '';
      }
    }, 3200);
  };

  if (!isPictureInPictureSupported(doc)) {
    pipButton.disabled = true;
    pipButton.setAttribute('aria-disabled', 'true');
    pipButton.setAttribute(
      'title',
      'Picture-in-picture is not available in this browser.',
    );
    return;
  }

  updateButtonState();

  const video = getToyPictureInPictureVideo(doc);
  video.onenterpictureinpicture = () => updateButtonState();
  video.onleavepictureinpicture = () => updateButtonState();

  pipButton.addEventListener('click', async () => {
    const wasActive = isToyPictureInPictureActive(doc);
    pipButton.disabled = true;
    pipButton.setAttribute('aria-busy', 'true');
    showStatus(
      wasActive ? 'Closing picture in picture…' : 'Opening picture in picture…',
    );

    try {
      if (wasActive) {
        await exitToyPictureInPicture(doc);
      } else {
        await requestToyPictureInPicture(doc);
      }
      updateButtonState();
      showStatus(
        wasActive
          ? 'Picture in picture closed.'
          : 'Picture in picture enabled.',
      );
    } catch (_error) {
      showStatus('Unable to use picture in picture.');
      updateButtonState();
    } finally {
      pipButton.disabled = false;
      pipButton.removeAttribute('aria-busy');
    }
  });
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
  const fallbackReason = status.fallbackReason
    ? escapeHtml(status.fallbackReason)
    : null;
  const titleText = escapeHtml(
    status.fallbackReason ??
      (fallback
        ? 'WebGPU unavailable, using WebGL.'
        : 'WebGPU renderer active.'),
  );

  container.innerHTML = `
    <div class="renderer-status">
      <span class="renderer-pill ${pillClass}" title="${titleText}">
        ${fallback ? 'WebGL fallback' : 'WebGPU'}
      </span>
      ${fallbackReason ? `<small class="renderer-pill__detail">${fallbackReason}</small>` : ''}
      ${status.shouldRetryWebGPU ? `<button type="button" class="renderer-pill__retry">${status.triedWebGPU ? 'Retry WebGPU' : 'Try WebGPU'}</button>` : ''}
    </div>
  `;

  const retryBtn = container.querySelector('.renderer-pill__retry');
  retryBtn?.addEventListener('click', () => status.onRetry?.());
}

function setupThemeToggle(container: HTMLElement) {
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
    if (label) label.textContent = isDark ? 'Light mode' : 'Dark mode';
    if (icon) icon.textContent = isDark ? '☀️' : '🌙';
  };

  // Initial state
  const root = doc.documentElement;
  const currentTheme = root.classList.contains('light') ? 'light' : 'dark';
  updateUI(currentTheme);

  toggle.addEventListener('click', () => {
    const isLight = root.classList.contains('light');
    const nextTheme = isLight ? 'dark' : 'light';
    const win = doc.defaultView ?? window;

    // Use the global helper if available
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
