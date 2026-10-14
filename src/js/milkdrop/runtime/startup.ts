/**
 * Waits out startup for an edit that arrived while it was pending, and says
 * whether the edit still has the preset it was meant for.
 *
 * Startup's own pick lands during that wait, and so can the shell routing the
 * same deep-linked preset; both are where the edit was headed. A request for
 * any other preset (the visitor, the route, an agent) is newer than the edit
 * and keeps the stage. Applying the edit after it saved the edit as a draft of
 * a preset it was never written for.
 */
export async function awaitStartupForEdit({
  navigation,
  startupSettled,
  getStartupPresetId,
}: {
  navigation: {
    getLoadRequestRevision: () => number;
    getLatestRequestedPresetId: () => string | null;
  };
  startupSettled: Promise<void>;
  /** The preset startup resolved to, once it has; null before or without one. */
  getStartupPresetId: () => string | null;
}): Promise<boolean> {
  const requestedAt = navigation.getLoadRequestRevision();
  await startupSettled;
  return (
    navigation.getLoadRequestRevision() === requestedAt ||
    navigation.getLatestRequestedPresetId() === getStartupPresetId()
  );
}

export function shouldDeferStartupPresetFallback({
  pendingPresetId,
  activePresetId,
}: {
  pendingPresetId: string | null;
  activePresetId: string;
}) {
  return pendingPresetId !== null && activePresetId !== pendingPresetId;
}

/**
 * Why the runtime is showing the preset it is showing.
 *
 * Every one of these arrives through the same `selectPreset` call, so when a
 * preset turns up unexpectedly there is otherwise nothing to distinguish "the
 * URL asked for it", "it was remembered from last session" and "autoplay
 * advanced" — the answer previously required reading the startup code.
 */
export type MilkdropPresetSelectionReason =
  /** Compiled into the bundle; painted before the catalog resolves. */
  | 'boot-bundle'
  /** `?preset=` / an explicit selection request. */
  | 'deep-link'
  /** Restored from the previous session's stored preset. */
  | 'remembered'
  /** First entry of a requested collection. */
  | 'collection'
  /** Nothing was asked for: the deliberate first-run pick. */
  | 'first-selectable'
  /** Chosen by the UI, the route, or an agent after startup. */
  | 'requested'
  /** Autoplay advanced on its own. */
  | 'autoplay';

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
  return resolveStartupPresetChoice({
    requestedPresetId,
    preferredStartupPresetId,
    collectionEntryId,
    isBackendSelectable,
    getFirstSelectablePresetId,
    activeBackend,
  }).presetId;
}

/**
 * The same decision as {@link resolveStartupPresetId}, but reporting which
 * branch won. `resolveStartupPresetId` delegates here so the choice has one
 * implementation and the reported reason cannot drift from the id.
 */
export function resolveStartupPresetChoice({
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
}): {
  presetId: string | null;
  reason: MilkdropPresetSelectionReason;
} {
  const candidates: Array<{
    presetId: string | null;
    reason: MilkdropPresetSelectionReason;
  }> = [
    { presetId: requestedPresetId, reason: 'deep-link' },
    { presetId: preferredStartupPresetId, reason: 'remembered' },
    { presetId: collectionEntryId, reason: 'collection' },
  ];
  const preferred = candidates.find((candidate) => candidate.presetId);
  if (
    preferred?.presetId &&
    isBackendSelectable(preferred.presetId, activeBackend)
  ) {
    return { presetId: preferred.presetId, reason: preferred.reason };
  }
  return {
    presetId: getFirstSelectablePresetId(activeBackend),
    reason: 'first-selectable',
  };
}
