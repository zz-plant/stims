export function shouldDeferStartupPresetFallback({
  pendingPresetId,
  activePresetId,
}: {
  pendingPresetId: string | null;
  activePresetId: string;
}) {
  return pendingPresetId !== null && activePresetId !== pendingPresetId;
}

export function resolveStartupPresetId({
  requestedPresetId,
  preferredStartupPresetId,
  collectionEntryId,
  isBackendSelectable,
  getFirstSelectablePresetId,
  activeBackend,
}: {
  requestedPresetId: string | null;
  preferredStartupPresetId: string | null;
  collectionEntryId: string | null;
  isBackendSelectable: (
    presetId: string,
    backend: 'webgl' | 'webgpu',
  ) => boolean;
  getFirstSelectablePresetId: (backend: 'webgl' | 'webgpu') => string | null;
  activeBackend: 'webgl' | 'webgpu';
}) {
  const preferredPresetId =
    requestedPresetId ?? preferredStartupPresetId ?? collectionEntryId;
  if (!preferredPresetId) {
    return null;
  }
  if (
    preferredPresetId &&
    isBackendSelectable(preferredPresetId, activeBackend)
  ) {
    return preferredPresetId;
  }
  return getFirstSelectablePresetId(activeBackend);
}
