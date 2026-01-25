import {
  DEFAULT_QUALITY_PRESETS,
  getActiveQualityPreset,
  getSettingsPanel,
} from '../core/settings-panel';
import { defaultToyLifecycle } from '../core/toy-lifecycle.ts';

type StartOptions = {
  container?: HTMLElement | null;
  path: string;
  title?: string;
  description?: string;
  preferDemoAudio?: boolean;
};

type PageToyStartOptions = {
  container?: HTMLElement | null;
  preferDemoAudio?: boolean;
};

type PageToyConfig = Omit<StartOptions, keyof PageToyStartOptions>;

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
      'Choose a quality preset before opening the standalone toy page.',
  });

  settingsPanel.setQualityPresets({
    presets: DEFAULT_QUALITY_PRESETS,
    defaultPresetId: initialQuality.id,
  });

  const pageUrl = new URL(resolvePageSrc(path));
  if (preferDemoAudio) {
    pageUrl.searchParams.set('audio', 'demo');
  }

  const statusElement = document.createElement('div');
  statusElement.className = 'active-toy-status is-warning';
  statusElement.setAttribute('role', 'status');
  statusElement.setAttribute('aria-live', 'polite');

  const glow = document.createElement('div');
  glow.className = 'active-toy-status__glow';
  statusElement.appendChild(glow);

  const content = document.createElement('div');
  content.className = 'active-toy-status__content';
  statusElement.appendChild(content);

  const heading = document.createElement('h2');
  heading.textContent = 'Open the standalone toy page';
  content.appendChild(heading);

  const body = document.createElement('p');
  body.textContent =
    'This toy runs on its own page to avoid embedded frames. Use the buttons below to launch it.';
  content.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'active-toy-status__actions';

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'cta-button primary';
  openButton.textContent = preferDemoAudio
    ? 'Open toy with demo audio'
    : 'Open toy';
  openButton.addEventListener('click', () => {
    window.location.href = pageUrl.toString();
  });

  const newTabLink = document.createElement('a');
  newTabLink.className = 'cta-button';
  newTabLink.textContent = 'Open in new tab';
  newTabLink.href = pageUrl.toString();
  newTabLink.target = '_blank';
  newTabLink.rel = 'noopener noreferrer';

  actions.append(openButton, newTabLink);
  content.appendChild(actions);

  const activeToy = {
    dispose() {
      statusElement.remove();
      defaultToyLifecycle.unregisterActiveToy(activeToy);
    },
  };

  defaultToyLifecycle.adoptActiveToy(activeToy);
  target.appendChild(statusElement);

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
