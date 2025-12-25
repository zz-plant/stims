import { ensureWebGL } from './webgl-check.ts';

type BootstrapOptions = {
  mountSelector?: string;
  overlayTitle?: string;
  overlayDescription?: string;
  previewLabel?: string;
};

type FallbackContent = {
  title: string;
  description: string;
  previewLabel: string;
};

const FALLBACK_ID = 'rendering-fallback';

const defaultContent: FallbackContent = {
  title: 'WebGL or WebGPU is required',
  description:
    'This visual needs GPU acceleration to draw its 3D graphics. Update your browser or enable hardware acceleration to continue.',
  previewLabel: 'Static preview (visuals paused without GPU support)',
};

function getFallbackMount(mountSelector?: string) {
  if (typeof document === 'undefined') return null;
  if (mountSelector) {
    const mount = document.querySelector<HTMLElement>(mountSelector);
    if (mount) return mount;
  }
  return document.body;
}

function removeFallback(mountSelector?: string) {
  const mount = getFallbackMount(mountSelector);
  const existing = mount?.querySelector(`#${FALLBACK_ID}`);
  existing?.remove();
}

function renderFallback(content: FallbackContent, mountSelector?: string) {
  const mount = getFallbackMount(mountSelector);
  if (!mount) return;

  if (mount.querySelector(`#${FALLBACK_ID}`)) return;

  const container = document.createElement('section');
  container.id = FALLBACK_ID;
  container.className = 'rendering-fallback';
  container.setAttribute('role', 'status');

  const eyebrow = document.createElement('p');
  eyebrow.className = 'rendering-overlay__eyebrow';
  eyebrow.textContent = 'Playback unavailable';
  container.appendChild(eyebrow);

  const heading = document.createElement('h2');
  heading.textContent = content.title;
  container.appendChild(heading);

  const description = document.createElement('p');
  description.className = 'rendering-fallback__description';
  description.textContent = content.description;
  container.appendChild(description);

  const preview = document.createElement('div');
  preview.className = 'rendering-overlay__preview rendering-fallback__preview';
  const previewLabel = document.createElement('p');
  previewLabel.textContent = content.previewLabel;
  preview.appendChild(previewLabel);
  const previewPane = document.createElement('div');
  previewPane.className = 'rendering-overlay__preview-pane';
  previewPane.setAttribute('aria-hidden', 'true');
  preview.appendChild(previewPane);
  container.appendChild(preview);

  mount.appendChild(container);
}

export function bootstrapWebGL(options: BootstrapOptions = {}) {
  const content: FallbackContent = {
    title: options.overlayTitle ?? defaultContent.title,
    description: options.overlayDescription ?? defaultContent.description,
    previewLabel: options.previewLabel ?? defaultContent.previewLabel,
  };

  const supported = ensureWebGL({
    title: content.title,
    description: content.description,
    previewLabel: content.previewLabel,
  });

  if (supported) {
    removeFallback(options.mountSelector);
    return true;
  }

  renderFallback(content, options.mountSelector);
  return false;
}
