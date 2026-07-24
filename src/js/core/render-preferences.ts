export {
  COMPATIBILITY_MODE_KEY,
  clearRenderOverrides,
  getActiveRenderPreferences,
  isCompatibilityModeEnabled,
  type RenderPreferences,
  resetRenderPreferenceStore as resetRenderPreferencesState,
  setCompatibilityMode,
  setRenderPreferences,
  subscribeToRenderPreferences,
} from './state/render-preference-store.ts';
