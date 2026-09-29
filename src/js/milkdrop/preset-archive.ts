/**
 * Preset packs: `.zip` archives of `.milk` files, the way the MilkDrop
 * community has always shared presets.
 *
 * Import used to take `.milk` files one at a time, so a pack had to be
 * unzipped by hand first. This turns whatever the user picked into a flat list
 * of preset files: `.milk` files pass straight through, and each `.zip` is
 * expanded to the `.milk` entries inside it. Everything downstream (size and
 * binary checks, credit parsing, the per-file error summary) is unchanged.
 *
 * Archives are untrusted input, so expansion is bounded before any entry is
 * inflated: the archive's own size, the number of presets taken from it, and
 * the total size they claim. A zip whose headers lie about sizes is still
 * caught by the per-file checks after inflation.
 */

export type PresetFileLike = {
  name: string;
  size: number;
  text: () => Promise<string>;
};

export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const MAX_ARCHIVE_PRESETS = 2000;
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

export function isZipArchive(file: { name: string; type?: string }): boolean {
  return (
    /\.zip$/iu.test(file.name) ||
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed'
  );
}

/** A `.milk` entry worth importing: not a folder, not macOS resource-fork noise. */
export function isPresetEntry(path: string): boolean {
  const base = path.split('/').pop() ?? '';
  return (
    /\.milk$/iu.test(base) &&
    !base.startsWith('._') &&
    !path.split('/').includes('__MACOSX')
  );
}

export class PresetArchiveError extends Error {}

/** The `.milk` entries in a zip, as files named by their base name. */
export async function readPresetArchive(
  bytes: Uint8Array,
  archiveName: string,
): Promise<PresetFileLike[]> {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new PresetArchiveError(
      `the archive is larger than ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB.`,
    );
  }
  const { unzipSync } = await import('fflate');
  let taken = 0;
  let claimedBytes = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      // Runs before each entry is inflated: skip anything that is not a
      // preset, and stop taking entries once the pack exceeds the limits.
      filter: (file) => {
        if (!isPresetEntry(file.name)) return false;
        if (taken >= MAX_ARCHIVE_PRESETS) return false;
        if (claimedBytes + file.originalSize > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
          return false;
        }
        taken += 1;
        claimedBytes += file.originalSize;
        return true;
      },
    });
  } catch (error) {
    throw new PresetArchiveError(
      `"${archiveName}" is not a readable .zip archive (${
        error instanceof Error ? error.message : String(error)
      }).`,
    );
  }
  const decoder = new TextDecoder();
  return Object.entries(entries)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, data]) => ({
      name: path.split('/').pop() ?? path,
      size: data.byteLength,
      text: async () => decoder.decode(data),
    }));
}

/**
 * Flatten a selection of `.milk` and `.zip` files into preset files. An
 * archive that cannot be read, or holds no presets, is reported through
 * `onSkip` rather than failing the rest of the selection.
 */
export async function expandPresetSelection(
  files: ReadonlyArray<File>,
  onSkip: (name: string, reason: string) => void,
): Promise<PresetFileLike[]> {
  const expanded: PresetFileLike[] = [];
  for (const file of files) {
    if (!isZipArchive(file)) {
      expanded.push(file);
      continue;
    }
    try {
      const presets = await readPresetArchive(
        new Uint8Array(await file.arrayBuffer()),
        file.name,
      );
      if (presets.length === 0) {
        onSkip(file.name, 'the archive contains no .milk presets.');
        continue;
      }
      expanded.push(...presets);
    } catch (error) {
      onSkip(file.name, error instanceof Error ? error.message : String(error));
    }
  }
  return expanded;
}

/** A file name for a preset title that every OS and zip tool accepts. */
export function presetFileName(title: string): string {
  const cleaned = title
    .normalize('NFKD')
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 120);
  return `${cleaned || 'preset'}.milk`;
}

/**
 * The reverse of `readPresetArchive`: presets packed as a `.zip` of `.milk`
 * files, the form packs are shared in. Names are made unique the way a file
 * manager would (`Name (2).milk`), so two presets with one title both survive.
 */
export async function writePresetArchive(
  presets: ReadonlyArray<{ title: string; source: string }>,
): Promise<Uint8Array> {
  const { strToU8, zipSync } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  // Case-insensitive, as on the file systems these zips get unpacked onto.
  const taken: Record<string, true> = {};
  for (const preset of presets) {
    const base = presetFileName(preset.title).replace(/\.milk$/u, '');
    let name = `${base}.milk`;
    for (let n = 2; taken[name.toLowerCase()]; n += 1) {
      name = `${base} (${n}).milk`;
    }
    taken[name.toLowerCase()] = true;
    files[name] = strToU8(preset.source);
  }
  return zipSync(files, { level: 6 });
}
