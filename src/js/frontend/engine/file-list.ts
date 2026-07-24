export function toFileList(target: FileList | File[] | string) {
  if (typeof target !== 'string' && 'length' in target && 'item' in target) {
    return target;
  }

  const transfer = new DataTransfer();
  if (typeof target === 'string') {
    transfer.items.add(new File([target], 'imported-preset.milk'));
  } else {
    target.forEach((file) => transfer.items.add(file));
  }
  return transfer.files;
}
