/**
 * Compose measured + static signals into a per-preset quality score and
 * curatedRank in catalog.json. Re-run after new lab measurements land.
 *
 * Signals (each optional; scores degrade gracefully when unmeasured):
 *  - certification: fidelity class + visual evidence tier (all presets)
 *  - static audio reach from the preset's equations (all presets): 1 when
 *    the audio drives what it draws, 0.5 when only its waveform shows the
 *    audio, 0 when nothing drawn depends on it (lab:dataflow's tiers)
 *  - measured reactivity from scratch/preset-lab/<id>/reactivity.json
 *  - flash audit metrics from scratch/flash-audit-*.json (motion, flash risk)
 *  - near-duplicate penalty from dedup-catalog.ts similarity annotations
 *
 * Usage:
 *   bun run scripts/score-catalog-quality.ts          # write quality + curatedRank
 *   bun run scripts/score-catalog-quality.ts --dry    # report only
 */
import fs from 'node:fs';
import path from 'node:path';
import { compileMilkdropPresetSource } from '../src/js/milkdrop/compiler.ts';
import { type AudioTier, labelPresetAudio } from './preset-lab-dataflow.ts';

const REPO_ROOT = path.join(import.meta.dir, '..');
const CATALOG_PATH = path.join(
  REPO_ROOT,
  'public',
  'milkdrop-presets',
  'catalog.json',
);
const PRESET_LAB_DIR = path.join(REPO_ROOT, 'scratch', 'preset-lab');
const SCRATCH_DIR = path.join(REPO_ROOT, 'scratch');

type QualityComponents = {
  fidelity: number;
  evidence: number;
  staticAudio: number;
  measuredReactivity: number | null;
  motion: number | null;
  flashPenalty: number;
  duplicatePenalty: number;
  /** 1 - skip rate from live telemetry; absent until enough samples exist. */
  engagement?: number;
};

type CatalogPresetEntry = {
  id: string;
  order: number;
  file: string;
  tags: string[];
  expectedFidelityClass?: string;
  visualEvidenceTier?: string;
  visualCertification?: {
    fidelityClass?: string;
    visualEvidenceTier?: string;
  };
  similarity?: { clusterId: string; duplicateOf?: string };
  quality?: { score: number; components: QualityComponents };
  curatedRank?: number;
};

type CatalogDocument = { presets: CatalogPresetEntry[] };

const STATIC_AUDIO_BY_TIER: Record<AudioTier, number> = {
  driven: 1,
  'waveform-only': 0.5,
  none: 0,
};

/** How far audio reaches what the preset draws, from its equations alone.
 * Replaces a text search for audio names, which credited dead code, init
 * code and disabled waves, and missed waveform samples passed via megabuf. */
export function staticAudioScore(id: string, source: string): number {
  try {
    const { ir } = compileMilkdropPresetSource(source, { id });
    return STATIC_AUDIO_BY_TIER[labelPresetAudio(ir).tier];
  } catch {
    return 0;
  }
}

const FIDELITY_SCORES: Record<string, number> = {
  'near-exact': 1,
  high: 0.85,
  stylized: 0.6,
  divergent: 0.35,
  compiles: 0.2,
};

const EVIDENCE_SCORES: Record<string, number> = {
  visual: 1,
  runtime: 0.5,
  none: 0,
};

function loadReactivityScore(presetId: string): number | null {
  const file = path.join(PRESET_LAB_DIR, presetId, 'reactivity.json');
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    let best = 0;
    for (const variable of data.variables ?? []) {
      for (const scenario of Object.values(variable.scenarios ?? {}) as Array<{
        correlation?: number;
        stdDev?: number;
      }>) {
        const corr = Math.abs(scenario.correlation ?? 0);
        // Correlation on a flat signal is noise; require movement.
        if ((scenario.stdDev ?? 0) > 1e-6 && corr > best) best = corr;
      }
    }
    return Math.min(1, best);
  } catch {
    return null;
  }
}

function loadFlashReports(): Map<
  string,
  { exceedsThreshold: boolean; motionEnergy: number }
> {
  const out = new Map();
  if (!fs.existsSync(SCRATCH_DIR)) return out;
  const auditFiles = fs
    .readdirSync(SCRATCH_DIR)
    .filter((f) => /^flash-audit.*\.json$/u.test(f));
  for (const file of auditFiles) {
    try {
      const data = JSON.parse(
        fs.readFileSync(path.join(SCRATCH_DIR, file), 'utf8'),
      );
      for (const report of data.reports ?? []) {
        out.set(report.presetId, {
          exceedsThreshold: Boolean(report.exceedsThreshold),
          motionEnergy: report.motionEnergy ?? 0,
        });
      }
    } catch {
      // skip malformed audit files
    }
  }
  return out;
}

/** Optional engagement rows saved from the telemetry report's
 * "Preset engagement" query: [{presetId, events, skips, avg_dwell_ms}]. */
function loadEngagement(): Map<string, number> {
  const file = path.join(SCRATCH_DIR, 'preset-engagement.json');
  const out = new Map<string, number>();
  if (!fs.existsSync(file)) return out;
  try {
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const row of Array.isArray(rows) ? rows : []) {
      const events = Number(row.events ?? 0);
      if (!row.presetId || events < 5) continue; // too few samples to trust
      const skipRate = Number(row.skips ?? 0) / events;
      out.set(row.presetId, 1 - Math.min(1, skipRate));
    }
  } catch {
    // engagement is optional; malformed file just means unscored
  }
  return out;
}

export function scoreCatalogQuality(opts: { dry: boolean }) {
  const catalog: CatalogDocument = JSON.parse(
    fs.readFileSync(CATALOG_PATH, 'utf8'),
  );
  const flashReports = loadFlashReports();
  const engagement = loadEngagement();
  let measuredCount = 0;

  const scored = catalog.presets.map((entry) => {
    const fidelityClass =
      entry.visualCertification?.fidelityClass ??
      entry.expectedFidelityClass ??
      'compiles';
    const evidenceTier =
      entry.visualCertification?.visualEvidenceTier ??
      entry.visualEvidenceTier ??
      'none';

    let staticAudio = 0;
    const sourcePath = path.join(REPO_ROOT, 'public', entry.file);
    if (fs.existsSync(sourcePath)) {
      staticAudio = staticAudioScore(
        entry.id,
        fs.readFileSync(sourcePath, 'latin1'),
      );
    }

    // A measurement recorded in the catalog stays until a new one replaces
    // it, so a checkout without the scratch/ measurement files re-scores
    // without discarding them.
    const previous = entry.quality?.components;
    const measuredReactivity =
      loadReactivityScore(entry.id) ?? previous?.measuredReactivity ?? null;
    if (measuredReactivity !== null) measuredCount++;

    const flash = flashReports.get(entry.id);
    const motion = flash
      ? Math.min(1, flash.motionEnergy * 1000)
      : (previous?.motion ?? null);
    const flashPenalty = flash
      ? flash.exceedsThreshold
        ? 0.5
        : 0
      : (previous?.flashPenalty ?? 0);
    const duplicatePenalty = entry.similarity?.duplicateOf ? 0.3 : 0;

    const engagementScore =
      engagement.get(entry.id) ?? previous?.engagement ?? undefined;
    const components: QualityComponents = {
      fidelity: FIDELITY_SCORES[fidelityClass] ?? 0.2,
      evidence: EVIDENCE_SCORES[evidenceTier] ?? 0,
      staticAudio,
      measuredReactivity,
      motion,
      flashPenalty,
      duplicatePenalty,
      ...(engagementScore !== undefined ? { engagement: engagementScore } : {}),
    };

    // Weighted blend; measured signals substitute for their static proxies
    // when available rather than stacking on top of them.
    const reactivity =
      measuredReactivity !== null ? measuredReactivity : staticAudio * 0.4; // unmeasured: cap the credit a static hit earns
    const score =
      components.fidelity * 0.4 +
      components.evidence * 0.15 +
      reactivity * 0.3 +
      (motion ?? 0.5 * components.fidelity) * 0.15 +
      // Real-user keep rate outranks any proxy when we have it.
      (components.engagement !== undefined ? components.engagement * 0.25 : 0) -
      flashPenalty -
      duplicatePenalty;

    return { entry, components, score: Number(score.toFixed(4)) };
  });

  scored.sort((a, b) => b.score - a.score || a.entry.order - b.entry.order);
  scored.forEach(({ entry, components, score }, index) => {
    entry.quality = { score, components };
    entry.curatedRank = index + 1;
  });

  console.log(
    `[score] scored ${scored.length} presets (${measuredCount} with measured reactivity, ${flashReports.size} with flash metrics)`,
  );
  console.log('[score] top 5:');
  for (const { entry, score } of scored.slice(0, 5)) {
    console.log(`  ${score.toFixed(3)}  ${entry.id}`);
  }
  console.log('[score] bottom 3:');
  for (const { entry, score } of scored.slice(-3)) {
    console.log(`  ${score.toFixed(3)}  ${entry.id}`);
  }

  if (!opts.dry) {
    fs.writeFileSync(
      CATALOG_PATH,
      `${JSON.stringify(catalog, null, 2)}\n`,
      'utf8',
    );
    console.log('[score] catalog.json updated with quality + curatedRank');
  }
}

if (import.meta.main) {
  scoreCatalogQuality({ dry: process.argv.includes('--dry') });
}
