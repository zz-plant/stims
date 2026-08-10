import { useEngineSnapshot, useWorkspace } from './workspace-context';

export function RendererFallbackBadge() {
  const { engineSnapshot } = useEngineSnapshot();
  const { ui } = useWorkspace();

  if (engineSnapshot?.backend !== 'webgl') {
    return null;
  }

  return (
    <div className="renderer-fallback-badge" role="status">
      <button
        type="button"
        className="renderer-fallback-badge__label"
        onClick={() => ui.updatePanel('settings')}
        title="Your browser doesn't support WebGPU, so Stims is rendering with WebGL instead. Some effects may look or perform differently. Tap for settings."
        aria-label="Running on WebGL because WebGPU isn't available — open settings for details"
      >
        <span className="renderer-fallback-badge__dot" aria-hidden="true" />
        <span className="renderer-fallback-badge__text">WebGL</span>
      </button>
    </div>
  );
}
