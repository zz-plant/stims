import type { PanelState } from './contracts.ts';
import { UiIcon } from './workspace-ui.tsx';

export function StimsControlDock({
  audioSource,
  isFullscreen,
  panel,
  onOpenBrowse,
  onOpenSettings,
  onShufflePreset,
  onAudioStop,
  onToggleFullscreen,
  onShowCurrentLink,
  onToggleTheme,
}: {
  audioSource: string | null | undefined;
  isFullscreen: boolean;
  panel: PanelState;
  onOpenBrowse: () => void;
  onOpenSettings: () => void;
  onShufflePreset: () => void;
  onAudioStop: () => void;
  onToggleFullscreen: () => void;
  onShowCurrentLink: () => void;
  onToggleTheme?: () => void;
}) {
  return (
    <div
      className="stims-shell__stage-dock"
      role="toolbar"
      aria-label="Live controls"
    >
      <button
        type="button"
        className="stims-shell__stage-tool"
        data-active={String(panel === 'browse')}
        aria-label="Open browse panel"
        title="Open browse panel"
        onClick={onOpenBrowse}
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
        onClick={onOpenSettings}
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
        onClick={onShufflePreset}
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
          onClick={onAudioStop}
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
        onClick={onShowCurrentLink}
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
