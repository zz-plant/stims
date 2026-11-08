/**
 * The Continuous Aesthetic Compass: project the shipped 256-d visual
 * embeddings into a 2D plane so a visitor can drag across a map of looks
 * instead of paging through a grid.
 *
 * The projection is a two-component PCA of the preview vectors, then oriented
 * with the visual-term vocabulary so the axes read as human directions:
 *
 *   X: organic liquid  ←→  geometric wireframe
 *   Y: hypnotic ambient ←→  reactive strobe
 *
 * This module is the pure math plus the loader. It has no React and no DOM,
 * so the projection can be unit-tested against synthetic vectors.
 */
import {
  loadPresetVisualVectors,
  loadVisualTermVocabulary,
} from './preset-visual-vectors.ts';

/** Upper bound on the points the compass renders (the catalog is ~1,800). */
export const MAX_COMPASS_POINTS = 8192;

/** At most this many vectors feed the covariance estimate. */
const PCA_SAMPLE_LIMIT = 800;

/** Power-iteration passes; the dominant directions settle well before this. */
const PCA_ITERATIONS = 60;

export interface CompassSample {
  presetId: string;
  vector: ArrayLike<number>;
}

export interface CompassPoint {
  presetId: string;
  /** Normalized to [-1, 1]. */
  x: number;
  /** Normalized to [-1, 1]. */
  y: number;
}

export interface CompassAxis {
  /** The direction that increases the coordinate. */
  positive: string;
  /** The direction that decreases it. */
  negative: string;
}

export interface AestheticCompass {
  points: CompassPoint[];
  xAxis: CompassAxis;
  yAxis: CompassAxis;
  /** Nearest projected point to a normalized (x, y), or null if empty. */
  nearestPreset(x: number, y: number): string | null;
}

const X_AXIS: CompassAxis = {
  positive: 'Geometric wireframe',
  negative: 'Organic liquid',
};
const Y_AXIS: CompassAxis = {
  positive: 'Reactive strobe',
  negative: 'Hypnotic ambient',
};

function dot(a: ArrayLike<number>, b: ArrayLike<number>, dims: number): number {
  let sum = 0;
  for (let i = 0; i < dims; i += 1) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

function meanVector(samples: CompassSample[], dims: number): Float64Array {
  const mean = new Float64Array(dims);
  if (samples.length === 0) return mean;
  for (const sample of samples) {
    for (let i = 0; i < dims; i += 1) mean[i] += sample.vector[i] ?? 0;
  }
  for (let i = 0; i < dims; i += 1) mean[i] /= samples.length;
  return mean;
}

/**
 * Covariance matrix from a bounded sample. Returned as a flat dims×dims
 * array so the power iteration is one tight loop.
 */
function covariance(
  samples: CompassSample[],
  mean: Float64Array,
  dims: number,
): Float64Array {
  const matrix = new Float64Array(dims * dims);
  const step = Math.max(1, Math.ceil(samples.length / PCA_SAMPLE_LIMIT));
  let used = 0;
  const centered = new Float64Array(dims);
  for (let s = 0; s < samples.length; s += step) {
    const vector = samples[s].vector;
    for (let i = 0; i < dims; i += 1) {
      centered[i] = (vector[i] ?? 0) - mean[i];
    }
    for (let i = 0; i < dims; i += 1) {
      const ci = centered[i];
      if (ci === 0) continue;
      const rowOffset = i * dims;
      for (let j = i; j < dims; j += 1) {
        matrix[rowOffset + j] += ci * centered[j];
      }
    }
    used += 1;
  }
  const scale = used > 0 ? 1 / used : 0;
  for (let i = 0; i < dims; i += 1) {
    const rowOffset = i * dims;
    for (let j = i; j < dims; j += 1) {
      const value = matrix[rowOffset + j] * scale;
      matrix[rowOffset + j] = value;
      matrix[j * dims + i] = value;
    }
  }
  return matrix;
}

function multiply(
  matrix: Float64Array,
  vector: Float64Array,
  dims: number,
): Float64Array {
  const out = new Float64Array(dims);
  for (let i = 0; i < dims; i += 1) {
    const rowOffset = i * dims;
    let sum = 0;
    for (let j = 0; j < dims; j += 1) {
      sum += matrix[rowOffset + j] * vector[j];
    }
    out[i] = sum;
  }
  return out;
}

function normalize(vector: Float64Array, dims: number): Float64Array {
  let norm = 0;
  for (let i = 0; i < dims; i += 1) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return vector;
  for (let i = 0; i < dims; i += 1) vector[i] /= norm;
  return vector;
}

function powerIteration(
  matrix: Float64Array,
  dims: number,
  orthogonalTo?: Float64Array,
): Float64Array {
  // Deterministic start: a vector that cannot be accidentally orthogonal to
  // the dominant direction in practice, and identical across runs.
  let vector: Float64Array = new Float64Array(dims);
  for (let i = 0; i < dims; i += 1) vector[i] = Math.sin(i + 1);
  vector = normalize(vector, dims);
  for (let iter = 0; iter < PCA_ITERATIONS; iter += 1) {
    vector = multiply(matrix, vector, dims);
    if (orthogonalTo) {
      const projection = dot(vector, orthogonalTo, dims);
      for (let i = 0; i < dims; i += 1) {
        vector[i] -= projection * orthogonalTo[i];
      }
    }
    vector = normalize(vector, dims);
  }
  return vector;
}

function normalizeRange(values: number[]): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return { min: 0, max: 1 };
  }
  return { min, max };
}

function toUnit(value: number, min: number, max: number): number {
  const span = max - min || 1;
  return ((value - min) / span) * 2 - 1;
}

/**
 * Build the 2D compass from normalized vectors and the visual-term
 * vocabulary. Pure and deterministic: the same input always yields the same
 * projection.
 */
export function buildAestheticCompass(
  samples: CompassSample[],
  termVectors: ReadonlyMap<string, ArrayLike<number>>,
): AestheticCompass {
  const bounded = samples
    .filter((sample) => sample.vector.length > 0)
    .slice(0, MAX_COMPASS_POINTS);
  if (bounded.length === 0) {
    return {
      points: [],
      xAxis: X_AXIS,
      yAxis: Y_AXIS,
      nearestPreset: () => null,
    };
  }
  const dims = bounded[0].vector.length;
  const mean = meanVector(bounded, dims);
  const matrix = covariance(bounded, mean, dims);

  const pc1 = powerIteration(matrix, dims);
  const pc2 = powerIteration(matrix, dims, pc1);

  // Orient the axes with the term vocabulary when it has the words.
  const projectTerm = (term: string): { x: number; y: number } | null => {
    const vector = termVectors.get(term);
    if (!vector || vector.length !== dims) return null;
    const centered = new Float64Array(dims);
    for (let i = 0; i < dims; i += 1) {
      centered[i] = (vector[i] ?? 0) - mean[i];
    }
    return { x: dot(centered, pc1, dims), y: dot(centered, pc2, dims) };
  };

  const geometric = projectTerm('geometric');
  const organic = projectTerm('organic');
  if (geometric && organic && geometric.x < organic.x) {
    for (let i = 0; i < dims; i += 1) pc1[i] = -pc1[i];
  }
  const strobe = projectTerm('strobe');
  const ambient = projectTerm('ambient');
  if (strobe && ambient && strobe.y < ambient.y) {
    for (let i = 0; i < dims; i += 1) pc2[i] = -pc2[i];
  }

  const rawX: number[] = [];
  const rawY: number[] = [];
  const centered = new Float64Array(dims);
  for (const sample of bounded) {
    for (let i = 0; i < dims; i += 1) {
      centered[i] = (sample.vector[i] ?? 0) - mean[i];
    }
    rawX.push(dot(centered, pc1, dims));
    rawY.push(dot(centered, pc2, dims));
  }
  const xRange = normalizeRange(rawX);
  const yRange = normalizeRange(rawY);
  const points: CompassPoint[] = bounded.map((sample, index) => ({
    presetId: sample.presetId,
    x: toUnit(rawX[index], xRange.min, xRange.max),
    y: toUnit(rawY[index], yRange.min, yRange.max),
  }));

  return {
    points,
    xAxis: X_AXIS,
    yAxis: Y_AXIS,
    nearestPreset(x: number, y: number): string | null {
      let bestId: string | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const point of points) {
        const dx = point.x - x;
        const dy = point.y - y;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          bestId = point.presetId;
        }
      }
      return bestId;
    },
  };
}

let cachedCompass: Promise<AestheticCompass | null> | null = null;

/**
 * Load the shipped vectors and term vocabulary, then build the compass once
 * per page. Resolves null when the files are unavailable so callers can fall
 * back to the grid.
 */
export function loadAestheticCompass(): Promise<AestheticCompass | null> {
  cachedCompass ??= (async () => {
    try {
      const [vectors, terms] = await Promise.all([
        loadPresetVisualVectors(),
        loadVisualTermVocabulary(),
      ]);
      if (!vectors) {
        cachedCompass = null;
        return null;
      }
      const samples: CompassSample[] = [];
      for (const id of vectors.ids) {
        const vector = vectors.getVector(id);
        if (vector) samples.push({ presetId: id, vector });
      }
      const termVectors = new Map<string, ArrayLike<number>>();
      if (terms) {
        for (let i = 0; i < terms.terms.length; i += 1) {
          const row = terms.vectors[i];
          if (row) termVectors.set(terms.terms[i], row);
        }
      }
      return buildAestheticCompass(samples, termVectors);
    } catch (error) {
      console.debug('Aesthetic compass unavailable', error);
      cachedCompass = null;
      return null;
    }
  })();
  return cachedCompass;
}

/** Test seam: forget the memoized compass between cases. */
export function resetAestheticCompass(): void {
  cachedCompass = null;
}
