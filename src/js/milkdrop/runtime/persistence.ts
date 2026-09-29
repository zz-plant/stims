export const UI_PREFS_KEY = 'stims:milkdrop:ui';

export type UiPrefs = {
  autoplay?: boolean;
  blendDuration?: number;
  transitionMode?: 'blend' | 'cut';
  lastPresetId?: string;
  fallbackNotice?: string;
};

export function readUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    return raw ? (JSON.parse(raw) as UiPrefs) : {};
  } catch {
    return {};
  }
}

export function writeUiPrefs(update: Partial<UiPrefs>) {
  const next = {
    ...readUiPrefs(),
    ...update,
  };
  try {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify(next));
  } catch {
    return;
  }
}

export function downloadPresetFile(name: string, contents: string) {
  const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${name}.milk`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Save a `.zip` of presets (see `writePresetArchive`). */
export function downloadPresetArchive(name: string, bytes: Uint8Array) {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], {
    type: 'application/zip',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name.endsWith('.zip') ? name : `${name}.zip`;
  anchor.click();
  // Revoking in the same tick can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
