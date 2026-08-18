import { type ReactNode, useEffect, useState } from 'react';
import type { PresetTransitionPhase } from './hooks/usePresetTransition.ts';

/**
 * Destination still shown over the live canvas while the next preset
 * fetches and compiles. The outgoing preset keeps rendering underneath, but
 * naming the wait with the incoming preset's artwork makes the switch feel
 * immediate instead of unacknowledged. The fade-in is delayed in CSS so a
 * warm-cache switch (precompiled or previously loaded) never flashes the
 * still at all; the fade-out reveals the engine's own blend already running.
 *
 * The last shown id is kept through the fade-out so the image doesn't vanish
 * the frame the phase flips; a missing preview image (404) simply keeps the
 * layer hidden.
 */
function StageIncomingPreview({
  presetId,
  active,
}: {
  presetId: string | null;
  active: boolean;
}) {
  const [renderedId, setRenderedId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  useEffect(() => {
    if (active && presetId) {
      setRenderedId(presetId);
    }
  }, [active, presetId]);

  if (!renderedId) {
    return null;
  }

  const visible = active && presetId === renderedId && failedId !== renderedId;

  return (
    <div
      className="stims-shell__stage-incoming"
      data-visible={visible ? 'true' : 'false'}
      aria-hidden="true"
      onTransitionEnd={() => {
        if (!visible) {
          setRenderedId(null);
        }
      }}
    >
      <img
        src={`/milkdrop-presets/previews/${renderedId}.png`}
        alt=""
        decoding="async"
        onError={() => setFailedId(renderedId)}
      />
    </div>
  );
}

export function StimsStageFrame({
  activePresetId,
  activePresetTitle,
  children,
  incomingPresetId = null,
  liveMode,
  stageRef,
  transitionPhase = 'idle',
}: {
  activePresetId?: string | null;
  activePresetTitle?: string | null;
  children: ReactNode;
  incomingPresetId?: string | null;
  liveMode: boolean;
  stageRef: React.RefObject<HTMLDivElement | null>;
  transitionPhase?: PresetTransitionPhase;
}) {
  return (
    <section
      className="stims-shell__stage-section"
      aria-label="Visualizer stage"
    >
      <div
        className="stims-shell__stage-frame"
        data-active-preset-id={activePresetId ?? undefined}
        data-mode={liveMode ? 'live' : 'home'}
      >
        <div
          id="stims-visualizer"
          ref={stageRef}
          className="stims-shell__stage-root"
          role="img"
          aria-label="Audio-reactive visual output"
          tabIndex={-1}
        />
        <StageIncomingPreview
          presetId={incomingPresetId}
          active={transitionPhase === 'loading'}
        />
        <div className="stims-shell__sr-only" role="status" aria-live="polite">
          {/* The title flips at request time, before the canvas catches up —
              announce the load so the transition is perceivable non-visually
              too. Blending is skipped: it would only add announcement noise. */}
          {activePresetTitle
            ? transitionPhase === 'loading'
              ? `Loading ${activePresetTitle}`
              : `Now playing: ${activePresetTitle}`
            : ''}
        </div>
        {children}
      </div>
    </section>
  );
}

export function StimsFrameChrome({ children }: { children: ReactNode }) {
  return <div className="stims-shell__frame-chrome">{children}</div>;
}

export function StimsFrameHeader({ children }: { children: ReactNode }) {
  return <div className="stims-shell__frame-header">{children}</div>;
}

export function StimsCornerBrand({ children }: { children: ReactNode }) {
  return <div className="stims-shell__corner-brand">{children}</div>;
}

export function StimsRailActions({ children }: { children: ReactNode }) {
  return <div className="stims-shell__rail-actions">{children}</div>;
}
