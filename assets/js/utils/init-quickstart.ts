import toysData from '../toys-data.js';
import { DATA_SELECTORS, DATASET_KEYS } from './data-attributes.ts';
import { isMobileDevice } from './device-detect.ts';

type InitQuickstartOptions = {
  loadToy: typeof import('../loader.ts').loadToy;
};

type QuickstartToy = {
  slug: string;
  lifecycleStage?: string | null;
};

export const initQuickstartCta = ({ loadToy }: InitQuickstartOptions) => {
  const quickstarts = document.querySelectorAll(DATA_SELECTORS.quickstart);
  if (!quickstarts.length) return;

  const quickstartToys = toysData as QuickstartToy[];
  const isMobile = isMobileDevice();

  quickstarts.forEach((quickstart) => {
    if (!(quickstart instanceof HTMLElement)) return;

    const quickstartSlug = quickstart.dataset[DATASET_KEYS.quickstartSlug];
    const quickstartMode = quickstart.dataset[DATASET_KEYS.quickstartMode];
    const quickstartPool = quickstart.dataset[DATASET_KEYS.quickstartPool];
    const quickstartAudio = quickstart.dataset[DATASET_KEYS.quickstartAudio];
    const quickstartFlow = quickstart.dataset[DATASET_KEYS.quickstartFlow];

    const resolveFlowState = () => {
      if (quickstartFlow === undefined) return undefined;
      if (quickstartFlow === '' || quickstartFlow === 'true') return true;
      if (quickstartFlow === 'false') return false;
      return quickstartFlow === '1';
    };

    const resolveMobileFlowFallback = () => {
      if (quickstartFlow !== undefined) return resolveFlowState();
      if (isMobile && quickstartMode === 'random') return true;
      return undefined;
    };

    const resolveRandomSlug = () => {
      const normalizedPool = quickstartPool?.toLowerCase();
      const pool =
        normalizedPool === 'featured'
          ? quickstartToys.filter((toy) => toy.lifecycleStage === 'featured')
          : quickstartToys;
      const fallbackPool = pool.length ? pool : quickstartToys;
      if (!fallbackPool.length) return null;
      const index = Math.floor(Math.random() * fallbackPool.length);
      return fallbackPool[index]?.slug ?? null;
    };

    const resolveSlug = () => {
      if (quickstartSlug) return quickstartSlug;
      if (quickstartMode !== 'random') return null;
      return resolveRandomSlug();
    };

    quickstart.addEventListener('click', (event) => {
      const isModifiedClick =
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button === 1;
      if (isModifiedClick) return;

      const resolvedSlug = resolveSlug();
      if (!resolvedSlug) return;

      event.preventDefault();
      loadToy(resolvedSlug, {
        pushState: true,
        preferDemoAudio:
          quickstartMode === 'demo' || quickstartAudio === 'demo',
        startFlow: resolveMobileFlowFallback(),
      });
    });
  });
};
