import {
  DEFAULT_QUALITY_PRESETS,
  getActiveQualityPreset,
  getSettingsPanel,
} from '../core/settings-panel';
import type { ToyStartOptions } from '../core/toy-interface';
import { defaultToyLifecycle } from '../core/toy-lifecycle.ts';

type PageToyStartOptions = ToyStartOptions & {
  preferDemoAudio?: boolean;
};

type StartPageToyOptions = PageToyStartOptions & {
  path: string;
  title?: string;
  description?: string;
};

type PageToyConfig = Omit<StartPageToyOptions, keyof PageToyStartOptions>;

function resolvePageSrc(path: string) {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return new URL(path, window.location.origin).toString();
}

export function startPageToy({
  container,
  path,
  title,
  description,
  preferDemoAudio = false,
}: StartPageToyOptions) {
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
      'This toy currently runs through a dedicated page shell while module migration is in progress.',
  });

  settingsPanel.setQualityPresets({
    presets: DEFAULT_QUALITY_PRESETS,
    defaultPresetId: initialQuality.id,
  });

  const pageUrl = new URL(resolvePageSrc(path));
  if (preferDemoAudio) {
    pageUrl.searchParams.set('audio', 'demo');
  }

  const frame = document.createElement('iframe');
  frame.className = 'toy-frame';
  frame.title = title ?? 'Toy';
  frame.src = pageUrl.toString();
  frame.setAttribute('allow', 'autoplay; microphone; accelerometer; gyroscope');
  frame.setAttribute('loading', 'eager');
  frame.style.width = '100%';
  frame.style.minHeight = '70vh';
  frame.style.border = '0';
  frame.style.borderRadius = '20px';
  frame.style.background = 'rgba(5, 7, 24, 0.85)';

  const actions = document.createElement('div');
  actions.className = 'active-toy-status__actions';
  actions.style.marginTop = '1rem';

  const newTabLink = document.createElement('a');
  newTabLink.className = 'cta-button';
  newTabLink.textContent = 'Open in new tab';
  newTabLink.href = pageUrl.toString();
  newTabLink.target = '_blank';
  newTabLink.rel = 'noopener noreferrer';

  actions.appendChild(newTabLink);

  const wrapper = document.createElement('div');
  wrapper.className = 'active-toy-status';
  wrapper.append(frame, actions);

  const activeToy = {
    dispose() {
      wrapper.remove();
      defaultToyLifecycle.unregisterActiveToy(activeToy);
    },
  };

  defaultToyLifecycle.adoptActiveToy(activeToy);
  target.appendChild(wrapper);

  return activeToy;
}

export function createPageToyStarter(config: PageToyConfig) {
  return function start({
    container,
    preferDemoAudio,
  }: PageToyStartOptions = {}) {
    return startPageToy({
      container,
      preferDemoAudio,
      ...config,
    });
  };
}
