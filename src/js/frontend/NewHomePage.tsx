import { AudioSourcePanel } from './AudioSourcePanel.tsx';
import { useWorkspace } from './workspace-context.tsx';

export function NewHomePage() {
  const { ui, engine } = useWorkspace();

  return (
    <section
      className="stims-shell__launch stims-shell__launch--minimal"
      data-audio-controls
      aria-labelledby="stims-launch-title"
    >
      <div className="stims-shell__launch-center">
        <h1 id="stims-launch-title" className="stims-shell__launch-title">
          Stims
        </h1>
        <p className="stims-shell__launch-tagline">
          Audio-reactive visualizer
        </p>
        <div className="stims-shell__launch-actions-minimal">
          <button
            id="use-demo-audio"
            data-demo-audio-btn="true"
            type="button"
            className="stims-shell__launch-cta"
            disabled={!engine.engineReady}
            onClick={() => engine.handleAudioStart('demo')}
          >
            Play demo
          </button>
          <button
            type="button"
            className="stims-shell__launch-secondary"
            onClick={() => ui.updatePanel('browse')}
          >
            Browse presets
          </button>
        </div>
        <div className="stims-shell__launch-source-minimal">
          <AudioSourcePanel showHelp={false} />
        </div>
      </div>
    </section>
  );
}
