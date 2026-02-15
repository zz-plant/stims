import { getRenderingSupport } from '../core/renderer-capabilities.ts';

const OVERLAY_ID = 'rendering-capability-overlay';
const MODAL_PARAM = 'modal';
const MODAL_VALUE = 'rendering-capability';
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

let restoreFocusTarget: HTMLElement | null = null;
let overlayCleanup: (() => void) | null = null;

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => !el.hasAttribute('aria-hidden'));
}

function trapFocus(panel: HTMLElement) {
  const focusable = () => getFocusableElements(panel);

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;

    const items = focusable();
    if (items.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = items[0];
    const last = items[items.length - 1];
    const active = panel.ownerDocument.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleFocusIn = (event: FocusEvent) => {
    if (!(event.target instanceof Node) || panel.contains(event.target)) {
      return;
    }

    const items = focusable();
    if (items.length > 0) {
      items[0].focus();
    } else {
      panel.focus();
    }
  };

  panel.addEventListener('keydown', handleKeydown);
  panel.ownerDocument.addEventListener('focusin', handleFocusIn);

  return () => {
    panel.removeEventListener('keydown', handleKeydown);
    panel.ownerDocument.removeEventListener('focusin', handleFocusIn);
  };
}

function updateModalUrlState(open: boolean) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const hasParam = url.searchParams.get(MODAL_PARAM) === MODAL_VALUE;

  if (open && !hasParam) {
    url.searchParams.set(MODAL_PARAM, MODAL_VALUE);
    window.history.pushState(
      { ...window.history.state, [MODAL_PARAM]: MODAL_VALUE },
      '',
      url,
    );
    return;
  }

  if (!open && hasParam) {
    url.searchParams.delete(MODAL_PARAM);
    window.history.replaceState({ ...window.history.state }, '', url);
  }
}

type TroubleshootingLink = {
  label: string;
  href: string;
};

type OverlayContent = {
  title: string;
  description: string;
  steps: string[];
  links: TroubleshootingLink[];
  previewLabel: string;
};

type EnsureOptions = Partial<
  Pick<OverlayContent, 'title' | 'description' | 'previewLabel'>
>;

function removeExistingOverlay() {
  const existing =
    typeof document !== 'undefined'
      ? document.getElementById(OVERLAY_ID)
      : null;
  existing?.remove();
  overlayCleanup?.();
  overlayCleanup = null;
  updateModalUrlState(false);
  if (restoreFocusTarget && document?.contains(restoreFocusTarget)) {
    restoreFocusTarget.focus();
  }
  restoreFocusTarget = null;
}

function buildOverlay(content: OverlayContent) {
  if (typeof document === 'undefined') return null;

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'rendering-overlay';
  overlay.setAttribute('aria-hidden', 'false');

  const backdrop = document.createElement('div');
  backdrop.className = 'rendering-overlay__backdrop';
  overlay.appendChild(backdrop);

  const panel = document.createElement('div');
  panel.className = 'rendering-overlay__panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.tabIndex = -1;
  overlay.appendChild(panel);

  const eyebrow = document.createElement('p');
  const headingId = `${OVERLAY_ID}-title`;
  const descriptionId = `${OVERLAY_ID}-description`;
  eyebrow.className = 'rendering-overlay__eyebrow';
  eyebrow.textContent = 'Playback unavailable';
  panel.appendChild(eyebrow);

  const heading = document.createElement('h1');
  heading.id = headingId;
  heading.textContent = content.title;
  panel.appendChild(heading);

  const body = document.createElement('p');
  body.className = 'rendering-overlay__description';
  body.id = descriptionId;
  body.textContent = content.description;
  panel.appendChild(body);

  panel.setAttribute('aria-labelledby', headingId);
  panel.setAttribute('aria-describedby', descriptionId);

  const actions = document.createElement('div');
  actions.className = 'rendering-overlay__actions';
  const backLink = document.createElement('a');
  backLink.className = 'rendering-overlay__button';
  backLink.href = 'index.html';
  backLink.textContent = 'Back to library';
  actions.appendChild(backLink);
  panel.appendChild(actions);

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

function addCapabilityOverlay(content: OverlayContent) {
  if (typeof document === 'undefined' || typeof document.body === 'undefined') {
    return;
  }

  if (document.getElementById(OVERLAY_ID)) {
    return;
  }

  const overlay = buildOverlay(content);
  if (!overlay) return;

  const attach = () => {
    document.body.appendChild(overlay);
    const panel = overlay.querySelector(
      '.rendering-overlay__panel',
    ) as HTMLElement | null;
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get(MODAL_PARAM) !== MODAL_VALUE) {
        removeExistingOverlay();
      }
    };
    window.addEventListener('popstate', handlePopState);
    restoreFocusTarget =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusCleanup = panel ? trapFocus(panel) : null;
    overlayCleanup = () => {
      focusCleanup?.();
      window.removeEventListener('popstate', handlePopState);
    };
    updateModalUrlState(true);
    const focusables = panel ? getFocusableElements(panel) : [];
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      panel?.focus();
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach, { once: true });
  } else {
    attach();
  }
}

export function ensureWebGL(options: EnsureOptions = {}) {
  const defaultContent: OverlayContent = {
    title: 'WebGL or WebGPU is required',
    description:
      'This visual needs GPU acceleration to draw its 3D graphics. Update your browser, enable hardware acceleration, or return to the library to switch to compatibility mode.',
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

  const content: OverlayContent = {
    ...defaultContent,
    ...options,
    steps: defaultContent.steps,
    links: defaultContent.links,
  };

  if (typeof navigator === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  const { hasWebGPU, hasWebGL } = getRenderingSupport();

  if (hasWebGPU || hasWebGL) {
    removeExistingOverlay();
    return true;
  }

  addCapabilityOverlay(content);
  return false;
}
