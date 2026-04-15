import {
  getFocusableElements,
  restoreFocusIfPresent,
  trapFocusWithin,
  updateModalQueryParam,
} from './modal-utils.ts';
import type { RenderingSupport } from './renderer-capabilities.ts';
import { getRenderingSupport } from './renderer-capabilities.ts';

const OVERLAY_ID = 'rendering-capability-overlay';
const MODAL_PARAM = 'modal';
const MODAL_VALUE = 'rendering-capability';

let restoreFocusTarget: HTMLElement | null = null;
let overlayCleanup: (() => void) | null = null;
let renderingSupportResolver: () => RenderingSupport = getRenderingSupport;

function updateModalUrlState(open: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  const hasParam =
    new URLSearchParams(window.location.search).get(MODAL_PARAM) ===
    MODAL_VALUE;

  if (open && !hasParam) {
    updateModalQueryParam({
      modalParam: MODAL_PARAM,
      nextValue: MODAL_VALUE,
      usePush: true,
    });
    return;
  }

  if (!open && hasParam) {
    updateModalQueryParam({
      modalParam: MODAL_PARAM,
      nextValue: null,
      usePush: false,
    });
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
  restoreFocusIfPresent(restoreFocusTarget);
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
  backLink.href = '/';
  backLink.textContent = 'Back to Stims';
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
    const focusCleanup = panel ? trapFocusWithin(panel) : null;
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

  const { hasWebGPU, hasWebGL } = renderingSupportResolver();

  if (hasWebGPU || hasWebGL) {
    removeExistingOverlay();
    return true;
  }

  addCapabilityOverlay(content);
  return false;
}

export function setRenderingSupportResolverForTests(
  resolver: (() => RenderingSupport) | null,
) {
  renderingSupportResolver = resolver ?? getRenderingSupport;
}
