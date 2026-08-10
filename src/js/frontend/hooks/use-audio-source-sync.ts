import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionRouteState } from '../contracts.ts';
import type {
  EngineSnapshot,
  MilkdropEngineAdapter,
} from '../engine/milkdrop-engine-adapter.ts';
import { formatAudioSourceLabel } from '../workspace-helpers.ts';

const GESTURE_EVENTS = ['pointerdown', 'touchstart', 'keydown'] as const;

export function useAudioSourceSync({
  engineRef,
  engineSnapshot,
  routeState,
  setRouteState,
  setStatusMessage,
}: {
  engineRef: { current: MilkdropEngineAdapter | null };
  engineSnapshot: EngineSnapshot | null;
  routeState: SessionRouteState;
  setRouteState: (
    updater: (previous: SessionRouteState) => SessionRouteState,
  ) => void;
  setStatusMessage: (message: string | null) => void;
}) {
  // Autoplay policy keeps the AudioContext suspended until a user gesture, so
  // on mobile the first demo-audio attempt reliably fails. The effect below
  // re-runs on every engine snapshot change, so without a guard each of those
  // renders fires another blocked activation — an unbounded stream of resume
  // attempts, one "AudioContext was not allowed to start" console warning per
  // attempt. Attempt once per route source instead, then wait for a real
  // gesture before re-arming.
  // Holding the consumed source in state (rather than a ref) keeps it a real
  // effect dependency: a new route source no longer matches, so it gets a
  // fresh attempt without any extra reset bookkeeping.
  const [attemptedSource, setAttemptedSource] =
    useState<SessionRouteState['audioSource']>(null);
  const gestureArmedRef = useRef(false);
  const detachGestureRetryRef = useRef<(() => void) | null>(null);

  const armGestureRetry = useCallback(() => {
    if (typeof document === 'undefined' || gestureArmedRef.current) return;
    gestureArmedRef.current = true;

    const onGesture = () => {
      detachGestureRetryRef.current?.();
      setAttemptedSource(null);
    };

    detachGestureRetryRef.current = () => {
      for (const event of GESTURE_EVENTS) {
        document.removeEventListener(event, onGesture, true);
      }
      detachGestureRetryRef.current = null;
      gestureArmedRef.current = false;
    };

    for (const event of GESTURE_EVENTS) {
      document.addEventListener(event, onGesture, {
        capture: true,
        passive: true,
      });
    }
  }, []);

  useEffect(() => () => detachGestureRetryRef.current?.(), []);

  // A shared permalink can encode a mic/tab/YouTube audio source
  // (`buildLaunchIntent` round-trips `routeState.audioSource` through the
  // URL). Those sources need a permission gesture the recipient hasn't made,
  // so — unlike demo audio above — we don't auto-attempt them; we just tell
  // the visitor the visuals are waiting on a source they haven't granted yet,
  // instead of leaving them looking at silent motion with no explanation.
  // Captured once at mount (not tracked live) so this only reacts to what the
  // page loaded with, never to a source the visitor just picked themselves —
  // that flow already requests the permission directly and sets `audioSource`
  // only once it succeeds.
  const [initialAudioSource] = useState(() => routeState.audioSource);
  const hasNotifiedPendingSourceRef = useRef(false);
  useEffect(() => {
    if (
      hasNotifiedPendingSourceRef.current ||
      !initialAudioSource ||
      initialAudioSource === 'demo' ||
      !engineSnapshot?.runtimeReady ||
      engineSnapshot?.audioActive
    ) {
      return;
    }
    hasNotifiedPendingSourceRef.current = true;
    setStatusMessage(
      `This link wants to use ${formatAudioSourceLabel(initialAudioSource)}. Open Audio Source and tap it to allow.`,
    );
  }, [
    initialAudioSource,
    engineSnapshot?.audioActive,
    engineSnapshot?.runtimeReady,
    setStatusMessage,
  ]);

  useEffect(() => {
    if (
      !engineRef.current?.isMounted() ||
      routeState.audioSource !== 'demo' ||
      !engineSnapshot?.runtimeReady ||
      engineSnapshot?.audioActive
    ) {
      return;
    }

    if (engineSnapshot?.audioSource === routeState.audioSource) {
      return;
    }

    if (attemptedSource === routeState.audioSource) {
      return;
    }
    setAttemptedSource(routeState.audioSource);

    void engineRef.current.setAudioSource({ source: 'demo' }).catch((error) => {
      setStatusMessage(
        error instanceof Error ? error.message : 'Unable to start demo audio.',
      );
      armGestureRetry();
    });
  }, [
    armGestureRetry,
    attemptedSource,
    engineRef,
    engineSnapshot?.audioActive,
    engineSnapshot?.audioSource,
    engineSnapshot?.runtimeReady,
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

  // The engine's initAudio-level track `ended` listener bumps
  // audioEndedAt whenever the live stream dies out from under us (mic
  // permission revoked, device unplugged, tab/display/YouTube capture
  // stopped from the browser's native UI). Mirror handleAudioStop's
  // established recovery path — clear the route's audioSource and tell
  // the user why the visualizer went quiet, rather than leaving it
  // running on stale audio with no explanation. Keyed off the timestamp
  // (not a boolean) since it's monotonic and never resets to null, so a
  // ref tracks the last value we've already reacted to.
  const lastAudioEndedAtRef = useRef<number | null>(null);
  useEffect(() => {
    const endedAt = engineSnapshot?.audioEndedAt ?? null;
    if (endedAt === null || endedAt === lastAudioEndedAtRef.current) {
      return;
    }
    lastAudioEndedAtRef.current = endedAt;

    setRouteState((previous) =>
      previous.audioSource === null
        ? previous
        : { ...previous, audioSource: null },
    );
    setStatusMessage('Audio input ended.');
  }, [engineSnapshot?.audioEndedAt, setRouteState, setStatusMessage]);
}
