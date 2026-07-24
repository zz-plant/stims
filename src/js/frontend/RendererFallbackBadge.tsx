import { useEffect, useState } from 'react';
import { useEngineSnapshot, useWorkspace } from './workspace-context';

const DISMISS_KEY = 'stims:renderer-fallback-dismissed';

export function RendererFallbackBadge() {
  const { engineSnapshot } = useEngineSnapshot();
  const { ui } = useWorkspace();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY)) {
        setDismissed(true);
      }
    } catch {}
  }, []);

  if (engineSnapshot?.backend !== 'webgl' || dismissed) {
    return null;
  }

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {}
  };

  return (
    <div className="renderer-fallback-badge" role="status">
      <button
        type="button"
        className="renderer-fallback-badge__label"
        onClick={() => ui.updatePanel('settings')}
        aria-label="WebGL fallback active — open settings"
      >
        <span aria-hidden="true">{'\u26A0'}</span> WebGL
      </button>
      <button
        type="button"
        className="renderer-fallback-badge__dismiss"
        onClick={handleDismiss}
        aria-label="Dismiss WebGL fallback notice"
      >
        {'\u00D7'}
      </button>
    </div>
  );
}
