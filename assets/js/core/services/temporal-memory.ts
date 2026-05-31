import { useCallback, useRef } from 'react';
import type { FrameStats } from './visual-embedding.ts';
import { extractFrameStats } from './visual-embedding.ts';

export interface MemoryEntry {
  presetId: string;
  timestamp: number;
  stats: FrameStats;
}

const MAX_ENTRIES = 200;
const buffer: MemoryEntry[] = [];

function histogramDistance(a: number[], b: number[]): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    sum += Math.abs(a[i] - b[i]) / 256;
  }
  return sum / len;
}

export function record(presetId: string, canvas: HTMLCanvasElement): void {
  const stats = extractFrameStats(canvas);
  buffer.push({ presetId, timestamp: Date.now(), stats });
  if (buffer.length > MAX_ENTRIES) {
    buffer.shift();
  }
}

export function findSimilarTo(
  stats: FrameStats,
  limit = 10,
): Array<{ entry: MemoryEntry; distance: number }> {
  return buffer
    .map((entry) => ({
      entry,
      distance: histogramDistance(entry.stats.histogram, stats.histogram),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

export function getRecent(n: number): MemoryEntry[] {
  return buffer.slice(-Math.min(n, buffer.length)).reverse();
}

export function useTemporalMemory() {
  const recordRef = useRef(record);
  recordRef.current = record;
  const findSimilarToRef = useRef(findSimilarTo);
  findSimilarToRef.current = findSimilarTo;
  const getRecentRef = useRef(getRecent);
  getRecentRef.current = getRecent;

  const recordFn = useCallback(
    (presetId: string, canvas: HTMLCanvasElement | null) => {
      recordRef.current(presetId, canvas as HTMLCanvasElement);
    },
    [],
  );

  const findSimilarToFn = useCallback(
    (stats: FrameStats, limit?: number) =>
      findSimilarToRef.current(stats, limit),
    [],
  );

  const getRecentFn = useCallback((n: number) => getRecentRef.current(n), []);

  return {
    record: recordFn,
    findSimilarTo: findSimilarToFn,
    getRecent: getRecentFn,
  };
}
