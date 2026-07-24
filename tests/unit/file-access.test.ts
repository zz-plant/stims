import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';

const fileOpenMock = mock();
const fileSaveMock = mock();

let openMilkdropPresetFiles: typeof import('../../assets/js/milkdrop/file-access.ts').openMilkdropPresetFiles;
let saveMilkdropPresetFile: typeof import('../../assets/js/milkdrop/file-access.ts').saveMilkdropPresetFile;

beforeAll(async () => {
  mock.module('browser-fs-access', () => ({
    fileOpen: fileOpenMock,
    fileSave: fileSaveMock,
  }));

  ({ openMilkdropPresetFiles, saveMilkdropPresetFile } = await import(
    '../../assets/js/milkdrop/file-access.ts'
  ));
});

afterEach(() => {
  fileOpenMock.mockReset();
  fileSaveMock.mockReset();
});

describe('milkdrop file access helpers', () => {
  test('opens multiple preset files through browser-fs-access', async () => {
    const file = new File(['title=Test\n'], 'test.milk', {
      type: 'text/plain',
    });
    fileOpenMock.mockResolvedValue([file]);

    const files = await openMilkdropPresetFiles();

    expect(files).toEqual([file]);
    expect(fileOpenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        multiple: true,
        id: 'stims-milkdrop-import',
      }),
    );
  });

  test('ignores cancelled import/export dialogs', async () => {
    fileOpenMock.mockImplementation(() => {
      throw new DOMException('Cancelled', 'AbortError');
    });
    fileSaveMock.mockImplementation(() => {
      throw new DOMException('Cancelled', 'AbortError');
    });

    await expect(openMilkdropPresetFiles()).resolves.toEqual([]);
    await expect(
      saveMilkdropPresetFile('cancelled', 'title=Cancelled\n'),
    ).resolves.toBeUndefined();
  });
});
