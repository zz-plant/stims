export type AudioMapperOptions = {
  fallbackValue?: number;
};

export function mapFrequencyToItems<T>(
  data: Uint8Array,
  items: T[],
  callback: (item: T, index: number, value: number) => void,
  options: AudioMapperOptions = {},
) {
  if (items.length === 0) return;

  const binsPerItem = data.length / items.length;
  const { fallbackValue } = options;

  items.forEach((item, index) => {
    const binIndex = Math.floor(index * binsPerItem);
    const value = data[binIndex] || fallbackValue || 0;
    callback(item, index, value);
  });
}
