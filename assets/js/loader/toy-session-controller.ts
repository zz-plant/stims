import { applyPartyMode } from '../core/party-mode.ts';
import type { ToyEntry } from '../data/toy-schema.ts';
import type { createToyView } from '../toy-view.ts';
import { createFlowTimer, getFlowIntervalMs } from './flow-timer.ts';
import { canUseHaptics, createHapticsController } from './haptics.ts';
import { createSessionTracking } from './session-tracking.ts';

export { getFlowIntervalMs } from './flow-timer.ts';

export function createToySessionController({
  toys,
  view,
}: {
  toys: ToyEntry[];
  view: ReturnType<typeof createToyView>;
}) {
  let flowActive = false;
  let partyModeActive = false;
  let flowCycleCount = 0;
  let nextToyInFlight = false;
  let handleNextToy: ((fromFlow?: boolean) => Promise<void>) | null = null;

  const session = createSessionTracking({ toys });
  const haptics = createHapticsController({
    view,
    isPartyModeActive: () => partyModeActive,
  });

  const flowTimer = createFlowTimer({
    getDelay: () =>
      getFlowIntervalMs({
        cycleCount: flowCycleCount,
        lastInteractionAt: session.getLastInteractionAt(),
      }),
    onTick: () => {
      if (handleNextToy) {
        void handleNextToy(true);
      }
    },
  });

  const scheduleFlow = () => {
    flowTimer.clear();
    if (!flowActive) return;
    flowTimer.schedule();
  };

  const setFlowActive = (active: boolean) => {
    flowActive = active;
    if (!flowActive) {
      flowCycleCount = 0;
      flowTimer.clear();
      return;
    }
    session.markInteraction();
    flowCycleCount = 0;
    scheduleFlow();
  };

  const setPartyModeActive = (active: boolean) => {
    partyModeActive = active;
    applyPartyMode({ enabled: active });
  };

  const createNextToyHandler = ({
    getCurrentSlug,
    loadToy,
    preferDemoAudio,
  }: {
    getCurrentSlug: () => string;
    loadToy: (
      slug: string,
      options?: { pushState?: boolean; preferDemoAudio?: boolean },
    ) => Promise<void>;
    preferDemoAudio: boolean;
  }) => {
    handleNextToy = async (fromFlow = false) => {
      if (nextToyInFlight) return;
      const nextSlug = session.pickNextToySlug(getCurrentSlug());
      if (!nextSlug) {
        if (fromFlow) {
          setFlowActive(false);
        }
        return;
      }

      nextToyInFlight = true;
      flowTimer.clear();
      try {
        flowCycleCount += fromFlow ? 1 : 0;
        await loadToy(nextSlug, { pushState: true, preferDemoAudio });
      } finally {
        nextToyInFlight = false;
        if (flowActive) {
          scheduleFlow();
        }
      }
    };

    return handleNextToy;
  };

  return {
    session,
    haptics,
    canUseHaptics,
    setFlowActive,
    setPartyModeActive,
    isFlowActive: () => flowActive,
    isPartyModeActive: () => partyModeActive,
    syncBeforeLoad: ({
      startFlow,
      startPartyMode,
    }: {
      startFlow?: boolean;
      startPartyMode?: boolean;
    }) => {
      session.initInteractionTracking();
      if (canUseHaptics() && !haptics.getHapticsEnabled()) {
        haptics.setFromPersisted();
      }
      if (typeof startFlow === 'boolean') {
        setFlowActive(startFlow);
      }
      if (typeof startPartyMode === 'boolean') {
        setPartyModeActive(startPartyMode);
      }
      haptics.syncBeatHapticsListener();
    },
    createNextToyHandler,
    clearOnBack: () => {
      setFlowActive(false);
      if (partyModeActive) {
        setPartyModeActive(false);
      }
      haptics.clearBeatHapticsListener();
    },
  };
}
