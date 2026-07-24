import { useEffect, useState } from 'react';
import {
  getActiveMotionPreference,
  subscribeToMotionPreference,
} from '../../core/motion-preferences.ts';
import {
  getActiveQualityPreset,
  QUALITY_STORAGE_KEY,
} from '../../core/settings-panel.ts';
import { subscribeToQualityPreset } from '../../core/state/quality-preset-store.ts';
import {
  getActiveRenderPreferences,
  subscribeToRenderPreferences,
} from '../../core/state/render-preference-store.ts';

export function useStoreSubscriptions() {
  const [qualityPreset, setQualityPreset] = useState(() =>
    getActiveQualityPreset({ storageKey: QUALITY_STORAGE_KEY }),
  );
  const [renderPreferences, setRenderPreferences] = useState(() =>
    getActiveRenderPreferences(),
  );
  const [motionPreference, setMotionPreference] = useState(() =>
    getActiveMotionPreference(),
  );

  useEffect(() => {
    const unsubscribe = subscribeToQualityPreset((preset) => {
      setQualityPreset(preset);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToRenderPreferences((preferences) => {
      setRenderPreferences(preferences);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToMotionPreference((preference) => {
      setMotionPreference(preference);
    });
    return unsubscribe;
  }, []);

  return {
    motionPreference,
    qualityPreset,
    renderPreferences,
  };
}
