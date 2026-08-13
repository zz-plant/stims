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
  // This used to have to discard `preferredStartupPresetId` when it held the
  // bundled placeholder: that id was absent from the catalog, so
  // `isBackendSelectable` waved it through as "fine on this backend" and it won
  // outright, bypassing the deliberate first-run pick on exactly the visit it
  // exists for. The bundled preset is now a real catalog id, so every branch
  // below resolves against the catalog and no id needs special handling.
  const preferredPresetId =
    requestedPresetId ?? preferredStartupPresetId ?? collectionEntryId;
  if (!preferredPresetId) {
    return getFirstSelectablePresetId(activeBackend);
  }
  if (
    preferredPresetId &&
    isBackendSelectable(preferredPresetId, activeBackend)
  ) {
    return preferredPresetId;
  }
  return getFirstSelectablePresetId(activeBackend);
}
