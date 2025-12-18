import WebGL from 'three/examples/jsm/capabilities/WebGL.js';

const OVERLAY_ID = 'rendering-capability-overlay';

/**
 * @typedef {Object} TroubleshootingLink
 * @property {string} label
 * @property {string} href
 */

/**
 * @typedef {Object} OverlayContent
 * @property {string} title
 * @property {string} description
 * @property {string[]} steps
 * @property {TroubleshootingLink[]} links
 * @property {string} previewLabel
 */

/**
 * Remove any previously rendered capability overlay.
 */
function removeExistingOverlay() {
  const existing = typeof document !== 'undefined' ? document.getElementById(OVERLAY_ID) : null;
  existing?.remove();
}

/**
 * @param {OverlayContent} content
 */
function buildOverlay(content) {
  if (typeof document === 'undefined') return null;

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'rendering-overlay';

  const backdrop = document.createElement('div');
  backdrop.className = 'rendering-overlay__backdrop';
  overlay.appendChild(backdrop);

  const panel = document.createElement('div');
  panel.className = 'rendering-overlay__panel';
  overlay.appendChild(panel);

  const eyebrow = document.createElement('p');
  eyebrow.className = 'rendering-overlay__eyebrow';
  eyebrow.textContent = 'Playback unavailable';
  panel.appendChild(eyebrow);

  const heading = document.createElement('h1');
  heading.textContent = content.title;
  panel.appendChild(heading);

  const body = document.createElement('p');
  body.className = 'rendering-overlay__description';
  body.textContent = content.description;
  panel.appendChild(body);

  const stepsList = document.createElement('ul');
  stepsList.className = 'rendering-overlay__steps';
  content.steps.forEach((step) => {
    const item = document.createElement('li');
    item.textContent = step;
    stepsList.appendChild(item);
  });
  panel.appendChild(stepsList);

  const links = document.createElement('div');
  links.className = 'rendering-overlay__links';
  content.links.forEach(({ label, href }) => {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer noopener';
    anchor.textContent = label;
    links.appendChild(anchor);
  });
  panel.appendChild(links);

  const preview = document.createElement('div');
  preview.className = 'rendering-overlay__preview';
  const previewLabel = document.createElement('p');
  previewLabel.textContent = content.previewLabel;
  preview.appendChild(previewLabel);
  const previewPane = document.createElement('div');
  previewPane.className = 'rendering-overlay__preview-pane';
  previewPane.setAttribute('aria-hidden', 'true');
  preview.appendChild(previewPane);
  panel.appendChild(preview);

  return overlay;
}

/**
 * @param {OverlayContent} content
 */
function addCapabilityOverlay(content) {
  if (typeof document === 'undefined' || typeof document.body === 'undefined') {
    return;
  }

  if (document.getElementById(OVERLAY_ID)) {
    return;
  }

  const overlay = buildOverlay(content);
  if (!overlay) return;

  const attach = () => document.body.appendChild(overlay);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach, { once: true });
  } else {
    attach();
  }
}

/**
 * @typedef {Partial<Pick<OverlayContent, 'title' | 'description' | 'previewLabel'>>} EnsureOptions
 */

/**
 * Ensure the current environment supports WebGL or WebGPU.
 * If not, show an overlay explaining what to do.
 * @param {EnsureOptions} [options]
 * @returns {boolean}
 */
export function ensureWebGL(options = {}) {
  /** @type {OverlayContent} */
  const defaultContent = {
    title: 'WebGL or WebGPU is required',
    description:
      'This visual needs GPU acceleration to draw its 3D graphics. Update your browser or enable hardware acceleration to continue.',
    steps: [
      'Use a modern browser like Chrome, Edge, or Firefox.',
      'Check that hardware acceleration is turned on in browser settings.',
      'If you are on a virtual machine or remote desktop, try a local device instead.',
    ],
    links: [
      { label: 'Test WebGL support', href: 'https://get.webgl.org/' },
      { label: 'WebGPU compatibility', href: 'https://webgpu.dev/' },
    ],
    previewLabel: 'Static preview (visuals paused without GPU support)',
  };

  const content = { ...defaultContent, ...options, steps: defaultContent.steps, links: defaultContent.links };

  if (typeof navigator === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  const hasWebGPU = Boolean(navigator?.gpu);
  const hasWebGL = typeof WebGL !== 'undefined' && WebGL.isWebGLAvailable();

  if (hasWebGPU || hasWebGL) {
    removeExistingOverlay();
    return true;
  }

  addCapabilityOverlay(content);
  return false;
}
