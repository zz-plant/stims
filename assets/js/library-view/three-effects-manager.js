const createNoopThreeEffects = () => ({
  init() {},
  syncCardPreviews() {},
  triggerLaunchTransition() {},
  startLaunchTransition() {},
  dispose() {},
});

export function createLibraryThreeEffectsManager({
  windowObject = typeof window === 'undefined' ? null : window,
  importEffects = () => import('./three-library-effects.ts'),
} = {}) {
  let threeEffects = createNoopThreeEffects();
  let threeEffectsLoader = null;
  let threeEffectsInitialized = false;
  let pendingCardPreviewSync = null;

  const replayPendingCardPreviewSync = () => {
    if (!pendingCardPreviewSync) return;
    const { cards, renderedToys } = pendingCardPreviewSync;
    threeEffects.syncCardPreviews(cards, renderedToys);
  };

  const ensureThreeEffects = async () => {
    if (threeEffectsLoader) return threeEffectsLoader;
    threeEffectsLoader = importEffects()
      .then(({ createLibraryThreeEffects }) => {
        threeEffects = createLibraryThreeEffects();
        if (threeEffectsInitialized) {
          threeEffects.init();
          replayPendingCardPreviewSync();
        }
        return threeEffects;
      })
      .catch((error) => {
        console.warn('Failed to initialize library Three.js effects', error);
        threeEffects = createNoopThreeEffects();
        return threeEffects;
      });
    return threeEffectsLoader;
  };

  return {
    syncCardPreviews(cards, renderedToys) {
      pendingCardPreviewSync = { cards, renderedToys };
      threeEffects.syncCardPreviews(cards, renderedToys);
    },
    requestThreeEffects() {
      if (!windowObject) return;
      const start = () => {
        void ensureThreeEffects();
      };
      if (typeof windowObject.requestIdleCallback === 'function') {
        windowObject.requestIdleCallback(start, { timeout: 600 });
        return;
      }
      windowObject.setTimeout(start, 120);
    },
    setInitialized(initialized = true) {
      threeEffectsInitialized = initialized;
    },
    triggerLaunchTransition() {
      threeEffects.triggerLaunchTransition();
    },
    startLaunchTransition(launchCard) {
      threeEffects.startLaunchTransition(launchCard);
    },
    dispose() {
      threeEffects.dispose();
    },
  };
}
