import { useEffect, useRef, useState } from 'react';
import { useEngineSnapshot, useWorkspace } from '../workspace-context.tsx';

export type PresetTransitionPhase = 'idle' | 'loading' | 'blending';

/**
 * A preset switch never lands instantly: the shell's title flips to the
 * incoming preset the moment it is requested, while the canvas keeps showing
 * the outgoing preset through fetch+compile and then a multi-second crossfade.
 * Nothing in the UI named that gap, so a switch read as "the title changed
 * but nothing happened". This hook derives the two in-flight phases so the
 * stage chrome can narrate them.
 *
 * - `loading`: a requested preset (selectedPreset) differs from the one the
 *   engine is rendering (activePresetId) — fetch/compile in flight.
 * - `blending`: activePresetId just flipped and the renderer is crossfading
 *   for the configured blend duration.
 */
const LOADING_DISPLAY_CAP_MS = 12_000;

export function usePresetTransition(): {
  phase: PresetTransitionPhase;
  /** Increments at each blend start; use as a React key to restart the sweep. */
  blendNonce: number;
  blendDurationMs: number;
} {
  const { engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();

  const selectedId = engine.selectedPreset?.id ?? null;
  const activeId = engineSnapshot?.activePresetId ?? null;
  const transitionMode = engineSnapshot?.transitionMode ?? 'blend';
  const blendDurationMs = Math.max(
    0,
    (engineSnapshot?.blendDuration ?? 0) * 1000,
  );

  // -- blending: timed window starting when the active preset flips ----------
  const [blendState, setBlendState] = useState<{
    nonce: number;
    untilMs: number;
  } | null>(null);
  const prevActiveIdRef = useRef<string | null>(activeId);
  const blendNonceRef = useRef(0);

  useEffect(() => {
    const prev = prevActiveIdRef.current;
    prevActiveIdRef.current = activeId;
    if (!activeId || prev === activeId) {
      return;
    }
    // prev === null is the initial launch, where the launch panel already
    // owns the loading story — only preset-to-preset switches crossfade.
    if (prev === null || transitionMode !== 'blend' || blendDurationMs <= 0) {
      return;
    }
    blendNonceRef.current += 1;
    setBlendState({
      nonce: blendNonceRef.current,
      untilMs: performance.now() + blendDurationMs,
    });
  }, [activeId, transitionMode, blendDurationMs]);

  useEffect(() => {
    if (!blendState) {
      return;
    }
    const remaining = blendState.untilMs - performance.now();
    if (remaining <= 0) {
      setBlendState(null);
      return;
    }
    const timer = setTimeout(() => setBlendState(null), remaining);
    return () => clearTimeout(timer);
  }, [blendState]);

  // -- loading: request in flight, capped so a failed load can't wedge it ---
  // The failure paths (error, 10s timeout in workspace-hooks) surface a toast
  // but leave the route pointing at the preset that never arrived, so the
  // selected/active mismatch would persist forever. The cap sits above that
  // timeout: any legitimate load resolves first.
  const loadingCandidate = Boolean(
    selectedId && activeId && selectedId !== activeId,
  );
  const [loadingExpired, setLoadingExpired] = useState(false);

  useEffect(() => {
    setLoadingExpired(false);
    // selectedId is a real dependency: retargeting to a different preset
    // mid-load must restart the cap, not inherit the previous timer.
    if (!loadingCandidate || !selectedId) {
      return;
    }
    const timer = setTimeout(
      () => setLoadingExpired(true),
      LOADING_DISPLAY_CAP_MS,
    );
    return () => clearTimeout(timer);
  }, [loadingCandidate, selectedId]);

  const phase: PresetTransitionPhase =
    loadingCandidate && !loadingExpired
      ? 'loading'
      : blendState !== null
        ? 'blending'
        : 'idle';

  return {
    phase,
    blendNonce: blendState?.nonce ?? 0,
    blendDurationMs,
  };
}
