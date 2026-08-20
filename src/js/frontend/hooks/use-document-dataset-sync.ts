import { useEffect } from 'react';
import { isDocumentAudioActive } from '../workspace-helpers.ts';

export function useDocumentDatasetSync({
  audioActive,
  agentMode,
}: {
  audioActive: boolean | undefined;
  agentMode: boolean | undefined;
}) {
  useEffect(() => {
    const liveSession = audioActive || isDocumentAudioActive();
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
