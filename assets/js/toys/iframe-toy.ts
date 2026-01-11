import {
  DEFAULT_QUALITY_PRESETS,
  getActiveQualityPreset,
  getSettingsPanel,
  type QualityPreset,
} from '../core/settings-panel';
import { defaultToyLifecycle } from '../core/toy-lifecycle.ts';

type StartOptions = {
  container?: HTMLElement | null;
  path: string;
  title?: string;
  allow?: string;
  description?: string;
};

function resolveIframeSrc(path: string) {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return new URL(path, window.location.origin).toString();
}

function postQualityPreset(iframe: HTMLIFrameElement, preset: QualityPreset) {
  iframe.contentWindow?.postMessage(
    { type: 'apply-quality-preset', preset },
    '*',
  );
}

export function startIframeToy({
  container,
  path,
  title,
  allow,
  description,
}: StartOptions) {
  const target = container ?? document.getElementById('active-toy-container');

  if (!target) {
    throw new Error('Active toy container is missing.');
  }

  const settingsPanel = getSettingsPanel();
  const initialQuality = getActiveQualityPreset();

  settingsPanel.configure({
    title: title ?? 'Toy settings',
    description:
      description ??
      'Adjust quality presets to balance performance and visual fidelity.',
  });

  const iframe = document.createElement('iframe');
  iframe.src = resolveIframeSrc(path);
  iframe.title = title ?? 'Web toy';
  iframe.allow = allow ?? 'microphone; camera; fullscreen';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';

  const sendPreset = (preset: QualityPreset) =>
    postQualityPreset(iframe, preset);

  settingsPanel.setQualityPresets({
    presets: DEFAULT_QUALITY_PRESETS,
    defaultPresetId: initialQuality.id,
    onChange: sendPreset,
  });

  const handleMessage = (event: MessageEvent) => {
    if ((event.data as { type?: string }).type === 'quality-sync-ready') {
      sendPreset(getActiveQualityPreset());
    }
  };
  window.addEventListener('message', handleMessage);

  const activeToy = {
    dispose() {
      iframe.remove();
      window.removeEventListener('message', handleMessage);
      defaultToyLifecycle.unregisterActiveToy(activeToy);
    },
  };

  defaultToyLifecycle.adoptActiveToy(activeToy);
  target.appendChild(iframe);

  return activeToy;
}
