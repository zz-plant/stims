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
  let pendingRequestHandle = 0;
  let pendingRequestKind = null;
  let lifecycleToken = 0;
  let disposed = false;

  const replayPendingCardPreviewSync = () => {
    if (!pendingCardPreviewSync) return;
    const { cards, renderedToys } = pendingCardPreviewSync;
    threeEffects.syncCardPreviews(cards, renderedToys);
  };

  const cancelPendingRequest = () => {
    if (!pendingRequestHandle || !windowObject) return;
    if (
      pendingRequestKind === 'idle' &&
      typeof windowObject.cancelIdleCallback === 'function'
    ) {
      windowObject.cancelIdleCallback(pendingRequestHandle);
    } else {
      windowObject.clearTimeout(pendingRequestHandle);
    }
    pendingRequestHandle = 0;
    pendingRequestKind = null;
  };

  const ensureThreeEffects = async () => {
    if (threeEffectsLoader) return threeEffectsLoader;
    const requestToken = lifecycleToken;
    threeEffectsLoader = importEffects()
      .then(({ createLibraryThreeEffects }) => {
        if (disposed || requestToken !== lifecycleToken) {
          return createNoopThreeEffects();
        }
        threeEffects = createLibraryThreeEffects();
        if (threeEffectsInitialized) {
          threeEffects.init();
          replayPendingCardPreviewSync();
        }
        return threeEffects;
      })
      .catch((error) => {
        if (disposed || requestToken !== lifecycleToken) {
          return createNoopThreeEffects();
        }
        console.warn('Failed to initialize library Three.js effects', error);
        threeEffects = createNoopThreeEffects();
        return threeEffects;
      });
    return threeEffectsLoader;
  };

  return {
    syncCardPreviews(cards, renderedToys) {
      if (disposed) return;
      pendingCardPreviewSync = { cards, renderedToys };
      threeEffects.syncCardPreviews(cards, renderedToys);
    },
    requestThreeEffects() {
      if (!windowObject || disposed) return;
      cancelPendingRequest();
      const start = () => {
        pendingRequestHandle = 0;
        pendingRequestKind = null;
        void ensureThreeEffects();
      };
      if (typeof windowObject.requestIdleCallback === 'function') {
        pendingRequestKind = 'idle';
        pendingRequestHandle = windowObject.requestIdleCallback(start, {
          timeout: 600,
        });
        return;
      }
      pendingRequestKind = 'timeout';
      pendingRequestHandle = windowObject.setTimeout(start, 120);
    },
    setInitialized(initialized = true) {
      threeEffectsInitialized = initialized;
      if (initialized) {
        disposed = false;
      }
    },
    triggerLaunchTransition() {
      if (disposed) return;
      threeEffects.triggerLaunchTransition();
    },
    startLaunchTransition(launchCard) {
      if (disposed) return;
      threeEffects.startLaunchTransition(launchCard);
    },
    dispose() {
      disposed = true;
      lifecycleToken += 1;
      cancelPendingRequest();
      pendingCardPreviewSync = null;
      threeEffects.dispose();
      threeEffects = createNoopThreeEffects();
      threeEffectsLoader = null;
      threeEffectsInitialized = false;
    },
  };
}
