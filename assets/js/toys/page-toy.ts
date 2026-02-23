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

  const frameUrl = new URL(pageUrl.toString());
  frameUrl.searchParams.set('embed', '1');

  const frame = document.createElement('iframe');
  frame.className = 'toy-frame';
  frame.title = title ?? 'Toy';
  frame.src = frameUrl.toString();
  frame.setAttribute('allow', 'autoplay; microphone; accelerometer; gyroscope');
  frame.setAttribute('loading', 'eager');

  const actions = document.createElement('div');
  actions.className = 'active-toy-status__actions';

  const newTabLink = document.createElement('a');
  newTabLink.className = 'cta-button';
  newTabLink.textContent = 'Open in new tab';
  newTabLink.href = pageUrl.toString();
  newTabLink.target = '_blank';
  newTabLink.rel = 'noopener noreferrer';

  actions.appendChild(newTabLink);

  const wrapper = document.createElement('div');
  wrapper.className = 'active-toy-status active-toy-status--page';
  wrapper.append(frame, actions);

  const activeToy = {
    dispose() {
      wrapper.remove();
      defaultToyLifecycle.unregisterActiveToy(activeToy);
    },
    // Expose startAudio to the parent wrapper by proxying it
    // to the iframe's contentWindow where the toy actually loads.
    startAudio: async (request: unknown) => {
      const targetWindow =
        frame.contentWindow as HTMLIFrameElement['contentWindow'] & {
          exposedStartAudio?: (req: unknown) => Promise<unknown>;
        };

      const isDemo =
        request === true || request === 'sample' || (request && typeof request === 'object' && 'source' in request && request.source === 'demo');
      const childRequest = isDemo
        ? { preferSynthetic: true, fallbackToSynthetic: true }
        : request;

      if (targetWindow?.exposedStartAudio) {
        return targetWindow.exposedStartAudio(childRequest);
      }

      console.warn(
        'Toy iframe did not immediately expose startAudio, waiting...',
      );
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (targetWindow?.exposedStartAudio) {
          return targetWindow.exposedStartAudio(childRequest);
        }
      }

      throw new Error(
        'Page toy did not expose startAudio to the parent window.',
      );
    },
  };

  // Register the proxy onto the main window for app.ts to use
  (window as any).startAudio = activeToy.startAudio;
  (window as any).startAudioFallback = () =>
    activeToy.startAudio({ preferSynthetic: true });

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
