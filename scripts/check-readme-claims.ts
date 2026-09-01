#!/usr/bin/env bun
/**
 * Keeps the repo's public claims aligned with what it actually ships.
 *
 * Docs that oversell are a support cost and an onboarding trap: a contributor
 * who reads that a foundation is shipped, then finds it experimental, has to
 * re-derive the real state from the code. This guard checks preset counts
 * against the bundled catalog, rejects README wording that promotes known
 * experimental work as finished, and rejects fidelity claims that no data file
 * in the repo supports.
 *
 * It covers `README.md` and the live docs under `docs/`, because the claim that
 * actually shipped a contradiction was in `docs/`, not the README:
 * `CASE_STUDY_COMPILER_RUNTIME.md` asserted a `< 1.5%` parity gate and "over
 * 99% compatibility" on the same day `MILKDROP_PROJECTM_PARITY_PLAN.md`
 * recorded most of the certified set diverging by 5–100%. Two rules follow from
 * that: a parity gate has to be one the manifest configures, and there is no
 * corpus-wide fidelity percentage to quote — visual evidence is per preset, and
 * `catalog.json` records how few presets carry it.
 *
 * Historical records (audits, critiques, dated status docs, `docs/archive`,
 * `docs/evidence`) are exempt: they describe a tree as it was, and rewriting
 * them would misrepresent the record. `docs/GUARDRAILS.md` is generated.
 *
 * It is the same principle as `check-doc-references.ts` applied to claims
 * rather than paths: documentation that lies is worse than documentation that
 * is missing, because it is trusted.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

/** Directories whose docs are a record of the past, not a live claim. */
const SKIP_DIRS = new Set(['archive', 'evidence']);

/** Generated from source that is itself checked. */
const GENERATED_DOCS = new Set(['docs/GUARDRAILS.md']);

/** Point-in-time findings rather than live instruction. */
const HISTORICAL_RECORD =
  /(AUDIT|CRITIQUE|ANTI_PATTERNS|RESEARCH|_REPORT_|assessment|STATUS_|critiques)/iu;

/**
 * Claims hedged as approximations are not count assertions. `~1,800-preset
 * catalog` is describing the order of magnitude on purpose.
 */
const APPROXIMATION =
  /(?:[~≈]|\b(?:roughly|about|nearly|around|approximately)\s+)$/iu;

/**
 * Phrasings that assert the size of the whole catalog. A bare `N presets` is
 * deliberately not one of them: docs legitimately count subsets ("1,521 presets
 * are fully supported on both backends"), and matching those would train
 * authors to stop citing measured numbers. Neither is `corpus`: the 71-preset
 * certification corpus is a different, deliberately bounded set.
 */
const PRESET_COUNT_PATTERNS = [
  /\b([\d][\d,]*)[- ]preset (?:catalog|library)\b/giu,
  /\*\*([\d][\d,]*) presets\*\*/giu,
  /\b([\d][\d,]*)\+ preset embeddings\b/giu,
  /\b([\d][\d,]*) presets? in the (?:bundled |shipped |public )?(?:catalog|library)\b/giu,
];

/**
 * A corpus-wide fidelity percentage. No file in the repo produces one: visual
 * evidence is promoted per preset into `measured-results.json`, and everything
 * else carries a runtime-only tier.
 */
const AGGREGATE_FIDELITY =
  /\b\d{1,3}(?:\.\d+)?\s*%\+?\s+(?:visual\s+|preset\s+)?(?:compatibility|parity|fidelity)\b/giu;

/** A parity gate expressed as a percentage ceiling on the diff. */
const PARITY_GATE =
  /(?:structural (?:difference|divergence)|mismatch)[^.\n]{0,60}?[<≤]\s*\$?\s*(\d+(?:\.\d+)?)\s*\\?%/giu;

async function collectClaimDocs(root: string) {
  const files = ['README.md'];
  const docsRoot = path.join(root, 'docs');
  const entries = await fs.readdir(docsRoot, { recursive: true });

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const relative = path.join('docs', entry);
    const segments = relative.split(path.sep);
    if (segments.some((segment) => SKIP_DIRS.has(segment))) continue;
    if (GENERATED_DOCS.has(relative)) continue;
    if (HISTORICAL_RECORD.test(path.basename(entry))) continue;
    files.push(relative);
  }

  return files.sort();
}

/** Configured mismatch ceilings, so a documented gate can be checked against one. */
async function readFailThresholds(root: string) {
  const thresholds = new Set<number>();
  const sources = [
    'src/data/milkdrop-parity/visual-reference-manifest.json',
    'src/data/milkdrop-parity/webgpu-certification-report.json',
    'src/data/milkdrop-parity/measured-results.json',
  ];

  for (const source of sources) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(path.join(root, source), 'utf8'));
    } catch {
      continue;
    }
    const stack: unknown[] = [parsed];
    while (stack.length > 0) {
      const node = stack.pop();
      if (Array.isArray(node)) {
        stack.push(...node);
        continue;
      }
      if (!node || typeof node !== 'object') continue;
      for (const [key, value] of Object.entries(node)) {
        if (key === 'failThreshold' && typeof value === 'number') {
          thresholds.add(value);
          continue;
        }
        if (value && typeof value === 'object') stack.push(value);
      }
    }
  }

  return thresholds;
}

/**
 * Keeps the public README honest about what actually ships.
 *
 * Previously part of `check:toys`; it was never toy-specific, so it outlived
 * the toy manifest pipeline that used to carry it.
 */
export async function validateReadmeProductClaims(
  issues: string[],
  root = repoRoot,
) {
  const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');

  const unshippedClaims = [
    {
      pattern: /Stem-Aware Audio Engine/iu,
      issue:
        'README presents stem separation as shipped, but the runtime currently exposes reserved stem signals only.',
    },
    {
      pattern: /WebMIDI & VJ Controls/iu,
      issue:
        'README presents MIDI control as fully shipped, but the current integration still lacks device-backed verification and persistent mappings.',
    },
    {
      pattern: /4K \/ 60FPS Video Export/iu,
      issue:
        'README presents creator-ready 4K audio-video export as fully shipped, but the native render and audio path still requires browser-backed output verification.',
    },
    {
      pattern: /AI Generation & Blending/iu,
      issue:
        'README presents model generation and blending as one fully shipped feature, but generation requires a configured hosted or local model and blending remains an optional API.',
    },
  ];

  for (const claim of unshippedClaims) {
    if (claim.pattern.test(readme)) {
      issues.push(claim.issue);
    }
  }
}

/**
 * Checks the numeric claims a reader would take as measured — preset counts,
 * corpus-wide fidelity, and parity gates — across the README and live docs.
 */
export async function validateDocumentedClaims(
  issues: string[],
  root = repoRoot,
) {
  const catalogPath = path.join(root, 'public/milkdrop-presets/catalog.json');
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8')) as {
    presets?: Array<{ visualEvidenceTier?: string }>;
  };
  const catalogEntries = Array.isArray(catalog.presets) ? catalog.presets : [];
  const catalogCount = catalogEntries.length;
  const visualEvidenceCount = catalogEntries.filter(
    (preset) => preset?.visualEvidenceTier === 'visual',
  ).length;
  const failThresholds = await readFailThresholds(root);
  const allowedGates = [...failThresholds]
    .map((threshold) => threshold * 100)
    .sort((a, b) => a - b);

  for (const file of await collectClaimDocs(root)) {
    const contents = await fs.readFile(path.join(root, file), 'utf8');

    for (const pattern of PRESET_COUNT_PATTERNS) {
      for (const match of contents.matchAll(pattern)) {
        const preceding = contents.slice(
          Math.max(0, (match.index ?? 0) - 24),
          match.index ?? 0,
        );
        if (APPROXIMATION.test(preceding)) continue;
        const claimedCount = Number((match[1] ?? '').replace(/,/gu, ''));
        if (claimedCount === catalogCount) continue;
        issues.push(
          `${file} claims a preset count of ${claimedCount}, but public/milkdrop-presets/catalog.json contains ${catalogCount} entries. Update the public claim to match the catalog source of truth.`,
        );
      }
    }

    for (const match of contents.matchAll(AGGREGATE_FIDELITY)) {
      issues.push(
        `${file} claims a corpus-wide fidelity figure ("${match[0].trim()}"), which no file in this repo measures. Visual evidence is per preset: catalog.json carries visualEvidenceTier "visual" on ${visualEvidenceCount} of ${catalogCount} entries. Cite measured-results.json or the parity plan's scoreboard instead.`,
      );
    }

    for (const match of contents.matchAll(PARITY_GATE)) {
      const claimedGate = Number(match[1]);
      if (!Number.isFinite(claimedGate)) continue;
      if (allowedGates.some((gate) => Math.abs(gate - claimedGate) < 1e-9)) {
        continue;
      }
      issues.push(
        `${file} documents a parity gate of ${claimedGate}% ("${match[0].trim()}"), which is not a failThreshold this repo configures (${
          allowedGates.length > 0
            ? allowedGates.map((gate) => `${gate}%`).join(', ')
            : 'none found'
        }). Quote the configured threshold, or change the manifest first.`,
      );
    }
  }
}

export async function runReadmeClaimChecks(root = repoRoot) {
  const issues: string[] = [];
  await validateReadmeProductClaims(issues, root);
  await validateDocumentedClaims(issues, root);
  return { issues: [...new Set(issues)] };
}

async function main() {
  const { issues } = await runReadmeClaimChecks();

  if (issues.length > 0) {
    console.error('Public claim check failed:\n');
    for (const issue of issues) {
      console.error(`  - ${issue}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('✔ README and docs claims match the shipped catalog and runtime');
}

const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (argvPath && import.meta.url === pathToFileURL(argvPath).href) {
  await main();
}
