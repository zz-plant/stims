import { fileOpen, fileSave } from 'browser-fs-access';

const PRESET_EXTENSIONS = ['.milk', '.txt'];
const PRESET_MIME_TYPES = ['text/plain'];

function isAbortError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.code === DOMException.ABORT_ERR)
  );
}

export async function openMilkdropPresetFiles(): Promise<File[]> {
  try {
    const files = await fileOpen({
      multiple: true,
      description: 'MilkDrop presets',
      extensions: PRESET_EXTENSIONS,
      mimeTypes: PRESET_MIME_TYPES,
      id: 'stims-milkdrop-import',
    });
    return Array.isArray(files) ? files : [files];
  } catch (error) {
    if (isAbortError(error)) {
      return [];
    }
    throw error;
  }
}

export async function saveMilkdropPresetFile(
  name: string,
  contents: string,
): Promise<void> {
  const fileName = name.endsWith('.milk') ? name : `${name}.milk`;
  const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });

  try {
    await fileSave(blob, {
      fileName,
      description: 'MilkDrop preset',
      extensions: ['.milk'],
      mimeTypes: PRESET_MIME_TYPES,
      id: 'stims-milkdrop-export',
    });
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    throw error;
  }
}
