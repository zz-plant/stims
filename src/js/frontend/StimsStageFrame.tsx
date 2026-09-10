import type { ReactNode } from 'react';
import type { PresetTransitionPhase } from './hooks/usePresetTransition.ts';
import { StageSignalField } from './SignalField.tsx';

export function StimsStageFrame({
  activePresetId,
  activePresetTitle,
  children,
  liveMode,
  stageRef,
  transitionPhase = 'idle',
}: {
  activePresetId?: string | null;
  activePresetTitle?: string | null;
  children: ReactNode;
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
        {/* Under the canvas, which is transparent wherever the preset draws
            nothing. Home mode alone: in live mode a preset owns every pixel,
            and the launch page is the one view that was left showing bare
            frame background when attract mode had nothing to show. */}
        {liveMode ? null : <StageSignalField />}
        {/* A group, not an image. The renderer's canvas lands inside here and
            is a focus stop in its own right — the stage key layer in
            core/unified-input.ts is how the visuals are steered, zoomed and
            rotated without a pointer — and `role="img"` presents its whole
            subtree as one flat graphic. So that canvas was reachable by Tab
            while being pruned out of the accessibility tree entirely: a stop
            a screen reader could land on but never announce. `group` keeps
            the stage's own name without hiding what is inside it. */}
        {/* biome-ignore lint/a11y/useSemanticElements: <fieldset> groups form controls; this groups a renderer canvas */}
        <div
          id="stims-visualizer"
          ref={stageRef}
          className="stims-shell__stage-root"
          role="group"
          aria-label="Audio-reactive visual output"
          tabIndex={-1}
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
