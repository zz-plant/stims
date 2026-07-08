import { fileOpen, fileSave } from 'browser-fs-access';

const PRESET_EXTENSIONS = ['.milk', '.txt'];
const PRESET_MIME_TYPES = ['text/plain'];

function isAbortError(error: unknown) {
  if (!(error instanceof Error || typeof error === 'object') || !error) {
    return false;
  }
  const candidate = error as { code?: number; name?: string };
  return (
    candidate.name === 'AbortError' ||
    (typeof DOMException !== 'undefined' &&
      candidate.code === DOMException.ABORT_ERR)
  );
}

export async function openMilkdropPresetFiles(): Promise<File[]> {
  return Promise.resolve()
    .then(() =>
      fileOpen({
        multiple: true,
        description: 'MilkDrop presets',
        extensions: PRESET_EXTENSIONS,
        mimeTypes: PRESET_MIME_TYPES,
        id: 'stims-milkdrop-import',
      }),
    )
    .then(
      (files) => (Array.isArray(files) ? files : [files]),
      (error) => {
        if (isAbortError(error)) {
          return [];
        }
        throw error;
      },
    );
}

export async function saveMilkdropPresetFile(
  name: string,
  contents: string,
): Promise<void> {
  if (typeof document === 'undefined') {
    return;
  }

  const fileName = name.endsWith('.milk') ? name : `${name}.milk`;
  const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });

  return Promise.resolve()
    .then(() =>
      Promise.resolve(
        fileSave(blob, {
          fileName,
          description: 'MilkDrop preset',
          extensions: ['.milk'],
          mimeTypes: PRESET_MIME_TYPES,
          id: 'stims-milkdrop-export',
        }),
      ).then(() => undefined),
    )
    .catch((error) => {
      if (isAbortError(error)) {
        return;
      }
      throw error;
    });
}
