export {
  COMPATIBILITY_MODE_KEY,
  clearRenderOverrides,
  getActiveRenderPreferences,
  isCompatibilityModeEnabled,
  MAX_PIXEL_RATIO_KEY,
  RENDER_SCALE_KEY,
  type RenderPreferences,
  resetRenderPreferenceStore as resetRenderPreferencesState,
  setCompatibilityMode,
  setRenderPreferences,
  subscribeToRenderPreferences,
} from './state/render-preference-store.ts';
