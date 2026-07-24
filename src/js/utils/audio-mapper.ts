export type AudioMapperOptions = {
  fallbackValue?: number;
  sampleWindow?: 'single' | 'average';
};

const DEFAULT_SAMPLE_WINDOW: NonNullable<AudioMapperOptions['sampleWindow']> =
  'single';

const getFallbackValue = (fallbackValue?: number): number =>
  Number.isFinite(fallbackValue) ? (fallbackValue as number) : 0;

const getSampleValue = (
  data: Uint8Array,
  start: number,
  end: number,
  sampleWindow: NonNullable<AudioMapperOptions['sampleWindow']>,
  fallbackValue: number,
): number => {
  if (data.length === 0 || start >= data.length) return fallbackValue;

  if (sampleWindow !== 'average') {
    return data[start] ?? fallbackValue;
  }

  const clampedEnd = Math.max(start + 1, Math.min(data.length, end));
  let sum = 0;
  for (let i = start; i < clampedEnd; i += 1) {
    sum += data[i] ?? fallbackValue;
  }
  return sum / (clampedEnd - start);
};

export function mapFrequencyToItems<T>(
  data: Uint8Array,
  items: T[],
  callback: (item: T, index: number, value: number) => void,
  options: AudioMapperOptions = {},
) {
  if (items.length === 0) return;

  const binsPerItem = data.length / items.length;
  const fallbackValue = getFallbackValue(options.fallbackValue);
  const sampleWindow = options.sampleWindow ?? DEFAULT_SAMPLE_WINDOW;

  items.forEach((item, index) => {
    const start = Math.floor(index * binsPerItem);
    const end = Math.floor((index + 1) * binsPerItem);
    const value = getSampleValue(data, start, end, sampleWindow, fallbackValue);
    callback(item, index, value);
  });
}
