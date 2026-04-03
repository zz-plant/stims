import {
  getMilkdropCapturedVideoCanvas,
  isMilkdropCapturedVideoReady,
} from '../core/services/captured-video-texture.ts';

const STAGE_LAYER_SELECTOR = '[data-youtube-stage-layer]';
const ACTIVE_TOY_CONTAINER_ID = 'active-toy-container';
const PREVIEW_SELECTOR = '[data-youtube-stage-preview]';
const FILTER_DEFS_ID = 'youtube-stage-filter-defs';
const FILTER_ID = 'youtube-stage-blend-filter';

function ensureFilterDefs(doc: Document) {
  const existing = doc.querySelector(`svg#${FILTER_DEFS_ID}`);
  if (
    existing &&
    existing.namespaceURI === 'http://www.w3.org/2000/svg' &&
    existing.localName === 'svg'
  ) {
    return existing;
  }

  const defs = doc.createElementNS(
    'http://www.w3.org/2000/svg',
    'svg',
  ) as SVGSVGElement;
  defs.setAttribute('id', FILTER_DEFS_ID);
  defs.setAttribute('aria-hidden', 'true');
  defs.setAttribute('width', '0');
  defs.setAttribute('height', '0');
  defs.innerHTML = `
    <defs>
      <filter id="${FILTER_ID}" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="0.35" result="soft" />
        <feColorMatrix
          in="soft"
          type="matrix"
          values="
            1.1 0 0 0 0
            0 1.04 0 0 0
            0 0 0.94 0 0
            0 0 0 1 0
          "
          result="toned"
        />
        <feOffset in="toned" dx="4" dy="0" result="shiftR" />
        <feOffset in="toned" dx="-3" dy="0" result="shiftB" />
        <feColorMatrix
          in="shiftR"
          type="matrix"
          values="
            1 0 0 0 0
            0 0 0 0 0
            0 0 0 0 0
            0 0 0 0.65 0
          "
          result="redGhost"
        />
        <feColorMatrix
          in="shiftB"
          type="matrix"
          values="
            0 0 0 0 0
            0 0 0 0 0
            0 0 1 0 0
            0 0 0 0.55 0
          "
          result="blueGhost"
        />
        <feBlend in="toned" in2="redGhost" mode="screen" result="ghosted" />
        <feBlend in="ghosted" in2="blueGhost" mode="screen" />
      </filter>
    </defs>
  `;
  (doc.body ?? doc.documentElement).appendChild(defs);
  return defs;
}

function ensurePreviewHost(layer: HTMLElement) {
  let preview = layer.querySelector(PREVIEW_SELECTOR) as HTMLElement | null;
  if (preview instanceof HTMLElement) {
    return preview;
  }

  preview = layer.ownerDocument.createElement('div');
  preview.className = 'youtube-stage-layer__preview';
  preview.dataset.youtubeStagePreview = 'true';
  layer.appendChild(preview);
  return preview;
}

function ensureStageLayer(doc: Document) {
  const activeToyContainer = doc.getElementById(ACTIVE_TOY_CONTAINER_ID);
  if (!(activeToyContainer instanceof HTMLElement)) {
    return null;
  }

  let layer = activeToyContainer.querySelector(
    STAGE_LAYER_SELECTOR,
  ) as HTMLElement | null;
  if (!(layer instanceof HTMLElement)) {
    layer = doc.createElement('div');
    layer.className = 'youtube-stage-layer';
    layer.dataset.youtubeStageLayer = 'true';
    layer.dataset.preserve = 'toy-ui';
    layer.hidden = true;
    activeToyContainer.appendChild(layer);
  }

  return layer;
}

export function mountYouTubeStageLayer(playerContainer: HTMLElement) {
  const doc = playerContainer.ownerDocument;
  const layer = ensureStageLayer(doc);
  if (!(layer instanceof HTMLElement)) {
    return null;
  }

  ensureFilterDefs(doc);
  ensurePreviewHost(layer);
  layer.hidden = false;
  playerContainer.hidden = false;
  playerContainer.classList.add('control-panel__embed--stage-layer');
  layer.appendChild(playerContainer);
  syncYouTubeStagePreview(doc);
  return layer;
}

export function syncYouTubeStagePreview(doc: Document) {
  const layer = doc.querySelector(STAGE_LAYER_SELECTOR);
  if (!(layer instanceof HTMLElement)) {
    return;
  }

  const preview = ensurePreviewHost(layer);
  const canvas = getMilkdropCapturedVideoCanvas();
  if (
    !canvas ||
    canvas.tagName !== 'CANVAS' ||
    !isMilkdropCapturedVideoReady()
  ) {
    layer.classList.remove('youtube-stage-layer--captured');
    preview.hidden = true;
    return;
  }

  canvas.classList.add('youtube-stage-layer__canvas');
  preview.hidden = false;
  preview.replaceChildren(canvas);
  layer.classList.add('youtube-stage-layer--captured');
}

export function hideYouTubeStageLayer(doc: Document) {
  const layer = doc.querySelector(STAGE_LAYER_SELECTOR);
  if (!(layer instanceof HTMLElement)) {
    return;
  }

  layer.classList.remove('youtube-stage-layer--captured');
  layer.hidden = true;
}
