import { useEffect } from 'react';
import type { SessionRouteState } from '../contracts.ts';
import type {
  EngineSnapshot,
  MilkdropEngineAdapter,
} from '../engine/milkdrop-engine-adapter.ts';

export function useAudioSourceSync({
  engineRef,
  engineSnapshot,
  routeState,
  setStatusMessage,
}: {
  engineRef: { current: MilkdropEngineAdapter | null };
  engineSnapshot: EngineSnapshot | null;
  routeState: SessionRouteState;
  setStatusMessage: (message: string | null) => void;
}) {
  useEffect(() => {
    if (
      !engineRef.current?.isMounted() ||
      routeState.audioSource !== 'demo' ||
      engineSnapshot?.audioActive
    ) {
      return;
    }

    void engineRef.current.setAudioSource({ source: 'demo' }).catch((error) => {
      setStatusMessage(
        error instanceof Error ? error.message : 'Unable to start demo audio.',
      );
    });
  }, [
    engineRef,
    engineSnapshot?.audioActive,
    routeState.audioSource,
    setStatusMessage,
  ]);

  useEffect(() => {
    if (
      !engineRef.current?.isMounted() ||
      !engineSnapshot?.audioActive ||
      routeState.audioSource !== null
    ) {
      return;
    }

    void engineRef.current.stopAudio().catch((error) => {
      console.debug('Audio stop failed during source switch.', error);
    });
  }, [engineRef, engineSnapshot?.audioActive, routeState.audioSource]);
}
