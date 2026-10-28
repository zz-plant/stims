/**
 * Reads and writes the measured search-landing evidence: how much of the stage a cold visitor sees lit on each preset's page.
 *
 * `lab:search-landing` writes it and `generate:seo` reads it. Both sides
 * import the thresholds from here so the instrument and the policy cannot
 * disagree about what "lit" means.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

export const SEARCH_LANDING_EVIDENCE_PATH =
  'src/data/search-landing-evidence.json';

export const SEARCH_LANDING_BACKENDS = ['webgpu', 'webgl'] as const;
export type SearchLandingBackend = (typeof SEARCH_LANDING_BACKENDS)[number];

/** The viewport a measurement key means when it names none. */
export const DEFAULT_LANDING_VIEWPORT = '1280x720';

/**
 * Where a measurement is stored: the backend for the default viewport, and
 * `<backend>@<width>x<height>` for any other, so a phone run sits beside the
 * desktop one instead of replacing it.
 */
export function measurementKey(
  backend: SearchLandingBackend,
  viewport: string,
) {
  return viewport === DEFAULT_LANDING_VIEWPORT
    ? backend
    : `${backend}@${viewport}`;
}

/** A pixel counts as lit above this Rec. 709 luminance (0-255). */
export const LIT_LUMINANCE = 24;

/**
 * Below this fraction of lit pixels, a landing shows nothing a visitor can
 * tell from a failed page. Calibrated on 40 random sitemap presets
 * (2026-10-07): every frame judged empty by eye read under 0.4%, and the
 * sparsest line-art preset that still reads as a picture (cyan lines on
 * black) read 1.1%.
 */
export const LIT_RATIO_FLOOR = 0.005;

/**
 * Per backend, the larger lit ratio of the two samples, or why there is no
 * measurement: `timeout` (the preset never went live) or `substituted:<id>`
 * (the app fell back to another preset, so the visitor never saw this one).
 */
export type SearchLandingMeasurement = number | string;

export type SearchLandingEvidence = {
  measuredAt: string;
  method: string;
  /** Preset id -> measurement key (see measurementKey) -> measurement. */
  presets: Record<string, Record<string, SearchLandingMeasurement>>;
};

export function readSearchLandingEvidence(
  rootDir = repoRoot,
): SearchLandingEvidence | null {
  const file = path.join(rootDir, SEARCH_LANDING_EVIDENCE_PATH);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as SearchLandingEvidence;
}

export function writeSearchLandingEvidence(
  evidence: SearchLandingEvidence,
  rootDir = repoRoot,
) {
  const sorted: SearchLandingEvidence['presets'] = {};
  for (const id of Object.keys(evidence.presets).sort()) {
    sorted[id] = evidence.presets[id] ?? {};
  }
  writeFileSync(
    path.join(rootDir, SEARCH_LANDING_EVIDENCE_PATH),
    `${JSON.stringify({ ...evidence, presets: sorted }, null, 2)}\n`,
  );
}

/**
 * True when any measured backend or viewport showed a visitor nothing: too
 * few lit pixels, or the preset never appeared. A context with no
 * measurement does not count against the preset, so newly added presets stay
 * offered until measured.
 */
export function landsBlank(
  measurements: Record<string, SearchLandingMeasurement>,
) {
  return Object.values(measurements).some(
    (value) => typeof value === 'string' || value < LIT_RATIO_FLOOR,
  );
}

/** Ids whose page should not be offered to search engines. */
export function readBlankLandingIds(rootDir = repoRoot): Set<string> {
  const evidence = readSearchLandingEvidence(rootDir);
  if (!evidence) return new Set();
  return new Set(
    Object.entries(evidence.presets)
      .filter(([, measurements]) => landsBlank(measurements))
      .map(([id]) => id),
  );
}
