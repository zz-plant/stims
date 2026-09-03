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
        <div
          id="stims-visualizer"
          ref={stageRef}
          className="stims-shell__stage-root"
          role="img"
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
