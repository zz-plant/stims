import { useCallback, useEffect, useState } from 'react';
import {
  getFullscreenElement,
  subscribeToFullscreenChange,
  toggleElementFullscreen,
} from '../fullscreen.ts';

export function useFullscreen(
  stageRef: React.RefObject<HTMLDivElement | null>,
  setStatusMessage: (message: string | null) => void,
) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleToggleFullscreen = useCallback(() => {
    const stageElement = stageRef.current?.parentElement;
    if (!stageElement) return;

    void (async () => {
      try {
        const toggled = await toggleElementFullscreen(stageElement, document);
        if (!toggled) {
          setStatusMessage('This browser cannot go full screen here.');
        }
      } catch {
        setStatusMessage('This browser cannot go full screen here.');
      }
    })();
  }, [stageRef, setStatusMessage]);

  useEffect(() => {
    const handleChange = () => {
      setIsFullscreen(Boolean(getFullscreenElement(document)));
    };
    handleChange();
    return subscribeToFullscreenChange(handleChange, document);
  }, []);

  return { isFullscreen, handleToggleFullscreen };
}
