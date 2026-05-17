import { useEffect } from 'react';

export function useDocumentDatasetSync({
  audioActive,
  agentMode,
}: {
  audioActive: boolean | undefined;
  agentMode: boolean | undefined;
}) {
  useEffect(() => {
    const liveSession =
      audioActive || document.body.dataset.audioActive === 'true';
    document.documentElement.dataset.focusedSession = liveSession
      ? 'live'
      : 'launch';
    if (agentMode) {
      document.documentElement.dataset.agentMode = 'true';
    } else {
      delete document.documentElement.dataset.agentMode;
    }
  }, [audioActive, agentMode]);
}
