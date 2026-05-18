import type { ReactNode } from 'react';

export function StimsStageAmbient() {
  return (
    <div className="stims-shell__stage-ambient" aria-hidden="true">
      <span className="stims-shell__stage-ambient-grid" />
      <span className="stims-shell__stage-ambient-beam" />
      <span className="stims-shell__stage-ambient-beam stims-shell__stage-ambient-beam--secondary" />
      <span className="stims-shell__stage-ambient-orb stims-shell__stage-ambient-orb--ember" />
      <span className="stims-shell__stage-ambient-orb stims-shell__stage-ambient-orb--sky" />
      <span className="stims-shell__stage-ambient-orb stims-shell__stage-ambient-orb--mint" />
      <span className="stims-shell__stage-ambient-ring" />
      <span className="stims-shell__stage-ambient-pulse" />
      <span className="stims-shell__stage-ambient-hint">
        Press play to start
      </span>
    </div>
  );
}

export function StimsStageFrame({
  children,
  liveMode,
  stageRef,
}: {
  children: ReactNode;
  liveMode: boolean;
  stageRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <section
      className="stims-shell__stage-section"
      aria-label="Visualizer stage"
    >
      <div
        className="stims-shell__stage-frame"
        data-mode={liveMode ? 'live' : 'home'}
      >
        <StimsStageAmbient />
        <div
          ref={stageRef}
          className="stims-shell__stage-root"
          role="img"
          aria-label="Audio-reactive visual output"
        />
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
