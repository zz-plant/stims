export function getBandAverage(
  data: Uint8Array,
  startRatio: number,
  endRatio: number,
): number {
  if (data.length === 0) return 0;
  const clampedStart = Math.max(0, Math.min(1, startRatio));
  const clampedEnd = Math.max(0, Math.min(1, endRatio));
  const start = Math.max(0, Math.floor(data.length * clampedStart));
  const end = Math.min(data.length, Math.ceil(data.length * clampedEnd));
  if (end <= start) return 0;

  let sum = 0;
  for (let i = start; i < end; i += 1) {
    sum += data[i];
  }
  return sum / (end - start);
}
