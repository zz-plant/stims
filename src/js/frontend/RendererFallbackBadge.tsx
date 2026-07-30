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
        aria-label="WebGL fallback active — open settings"
      >
        <span className="renderer-fallback-badge__dot" aria-hidden="true" />
        <span className="renderer-fallback-badge__text">WebGL</span>
      </button>
    </div>
  );
}
