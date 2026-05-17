import { useWorkspace } from './workspace-context.tsx';
import { UiIcon } from './workspace-ui.tsx';

export function StimsControlDock({
  isFullscreen,
  onToggleFullscreen,
  onToggleTheme,
}: {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onToggleTheme?: () => void;
}) {
  const w = useWorkspace();
  const panel = w.routeState.panel;
  const audioSource = w.engineSnapshot?.audioSource ?? w.routeState.audioSource;
  const audioEnergy = w.engineSnapshot?.audioEnergy ?? 0;
  const energyNorm = Math.min(1, Math.max(0, audioEnergy));

  return (
    <div
      className="stims-shell__stage-dock"
      role="toolbar"
      aria-label="Live controls"
      style={
        { '--stims-audio-glow': String(energyNorm) } as React.CSSProperties
      }
    >
      <button
        type="button"
        className="stims-shell__stage-tool"
        data-active={String(panel === 'browse')}
        aria-label="Open browse panel"
        title="Open browse panel"
        onClick={() => w.updatePanel('browse')}
      >
        <UiIcon
          name="sparkles"
          className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
        />
        <span className="stims-shell__stage-tool-label">Browse</span>
      </button>
      <button
        type="button"
        className="stims-shell__stage-tool"
        data-active={String(panel === 'settings')}
        aria-label="Open look settings"
        title="Open look settings"
        onClick={() => w.updatePanel('settings')}
      >
        <UiIcon
          name="sliders"
          className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
        />
        <span className="stims-shell__stage-tool-label">Style</span>
      </button>
      <button
        type="button"
        className="stims-shell__stage-tool"
        aria-label="Surprise me"
        title="Surprise me"
        onClick={w.handleShufflePreset}
      >
        <UiIcon
          name="pulse"
          className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
        />
        <span className="stims-shell__stage-tool-label">Surprise me</span>
      </button>
      {audioSource ? (
        <button
          type="button"
          className="stims-shell__stage-tool"
          aria-label="Stop audio"
          title="Stop audio"
          onClick={w.handleAudioStop}
        >
          <UiIcon
            name="close"
            className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
          />
          <span className="stims-shell__stage-tool-label">Stop</span>
        </button>
      ) : null}
      <button
        type="button"
        className="stims-shell__stage-tool"
        aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
        title={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
        onClick={onToggleFullscreen}
      >
        <UiIcon
          name="expand"
          className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
        />
        <span className="stims-shell__stage-tool-label">
          {isFullscreen ? 'Exit full screen' : 'Full screen'}
        </span>
      </button>
      <button
        type="button"
        className="stims-shell__stage-tool"
        aria-label="Share current link"
        title="Share current link"
        onClick={() => void w.handleShowCurrentLink()}
      >
        <UiIcon
          name="link"
          className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
        />
        <span className="stims-shell__stage-tool-label">Share</span>
      </button>
      {onToggleTheme ? (
        <button
          type="button"
          className="stims-shell__stage-tool"
          aria-label="Toggle theme"
          title="Toggle theme"
          onClick={onToggleTheme}
        >
          <UiIcon
            name="moon"
            className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
          />
          <span className="stims-shell__stage-tool-label">Theme</span>
        </button>
      ) : null}
    </div>
  );
}
