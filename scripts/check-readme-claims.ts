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
 * `CASE_STUDY_COMPILER_RUNTIME.md` (since deleted) asserted a `< 1.5%` parity gate and "over
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
 *
 * It also rejects copy that answers an objection no visitor has raised:
 * mind-reading ("you might be wondering"), reassurance ("don't worry"),
 * motive denials ("not another …"), negation openers ("Not a toy. A …") and
 * unasked self-justification ("we don't X because …"). The scan covers what
 * the site publishes: the README, every /learn/ source, the static pages and
 * agent files under `public/`, `index.html`, and the strings in `src/js/` and
 * `functions/` (comment lines skipped). A sentence that answers an objection a
 * visitor did raise carries a marker naming its row in `docs/objections.md`:
 * `<!-- objection: <id> -->` in markdown or HTML, `// objection: <id>` in
 * TypeScript, on the same line or the line above.
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
        'README presents MIDI control as fully shipped, but no physical controller has verified it and its control latency is unmeasured (mappings do persist per device).',
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

/**
 * Phrasings that answer an objection the reader has not raised. The rule and
 * the ledger of objections visitors did raise are in `docs/objections.md`;
 * keep this the only list of them.
 */
export const PRESUPPOSING_COPY: ReadonlyArray<{
  kind: string;
  pattern: RegExp;
}> = [
  {
    kind: 'mind-reading',
    pattern:
      /\b(?:you (?:might|may|could) (?:be )?(?:wonder(?:ing)?|think(?:ing)?)|you(?:'re| are) (?:probably )?(?:wondering|thinking)|worried (?:that|about)|before you ask)\b/iu,
  },
  {
    kind: 'reassurance',
    pattern:
      /\b(?:don'?t worry|do not worry|rest assured|no catch|no strings attached|no hidden (?:fees?|costs?|charges?|catch|agenda)|an honest (?:side-by-side|comparison|look|review|take))\b/iu,
  },
  {
    kind: 'motive denial',
    pattern:
      /\b(?:(?:this|it) (?:isn'?t|is not) (?:a |an )?(?:pitch|sales pitch|sales page|ad|advert)\b|we (?:won'?t|will not|never) (?:sell|spam|share your)|not (?:just )?another\b|we(?:'re| are) not trying to)/iu,
  },
  {
    kind: 'negation opener',
    pattern:
      /(?:^|[.!?>#]\s*)not (?:a|an|just a|just an) [^.!?\n<]{1,60}[.!?]\s+(?:a|an|it'?s|just)\b|\bunlike (?:other|most|many) (?:tools|visualizers|apps|sites|players)\b/iu,
  },
  {
    kind: 'self-justification',
    pattern: /\bwe (?:don'?t|do not|never) [^.!?\n]{1,80}\bbecause\b/iu,
  },
];

const OBJECTION_LEDGER = 'docs/objections.md';
const OBJECTION_MARKER =
  /(?:<!--\s*objection:\s*([a-z0-9-]+)\s*-->|\/\/\s*objection:\s*([a-z0-9-]+))/giu;

/** Pages the site serves, plus the README that GitHub shows as its front page. */
const PUBLISHED_COPY_FILES = [
  'README.md',
  'index.html',
  'public/404.html',
  'public/auth.md',
  'public/llms.txt',
  'public/llms-full.txt',
];
const PUBLISHED_COPY_DIRS = [
  { dir: 'public/.well-known', ext: /\.md$/u },
  { dir: 'src/js', ext: /\.tsx?$/u },
  { dir: 'functions', ext: /\.tsx?$/u },
];

async function listFiles(root: string, dir: string, ext: RegExp) {
  try {
    const entries = await fs.readdir(path.join(root, dir), { recursive: true });
    return entries
      .filter((entry) => ext.test(entry))
      .map((entry) => path.join(dir, entry).split(path.sep).join('/'));
  } catch {
    return [];
  }
}

/** Every file whose text a visitor can read on the site, repo-relative. */
export async function collectPublishedCopy(root = repoRoot) {
  const { LEARN_PAGES } = await import('../functions/shared/learn-pages.ts');
  const files = new Set([
    ...PUBLISHED_COPY_FILES,
    ...LEARN_PAGES.map((page) => page.source),
  ]);
  for (const { dir, ext } of PUBLISHED_COPY_DIRS) {
    for (const file of await listFiles(root, dir, ext)) files.add(file);
  }
  return [...files].sort();
}

/** Ids in the first column of the ledger's table. */
export function parseObjectionLedger(markdown: string) {
  const ids = new Set<string>();
  for (const line of markdown.split('\n')) {
    const cell = /^\|\s*`?([a-z0-9][a-z0-9-]*)`?\s*\|/u.exec(line)?.[1];
    if (cell && cell !== 'id') ids.add(cell);
  }
  return ids;
}

/** The text of a line a visitor reads, or '' for a line they never see. */
function visibleText(file: string, line: string, state: { inBlock: boolean }) {
  if (/\.tsx?$/u.test(file)) {
    const trimmed = line.trim();
    if (state.inBlock) {
      if (trimmed.includes('*/')) state.inBlock = false;
      return '';
    }
    if (trimmed.startsWith('/*')) {
      state.inBlock = !trimmed.includes('*/');
      return '';
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return '';
    return line;
  }
  if (/\.html$/u.test(file)) {
    if (state.inBlock) {
      if (/<\/(?:script|style)>/iu.test(line)) state.inBlock = false;
      return '';
    }
    if (
      /<(?:script|style)\b/iu.test(line) &&
      !/<\/(?:script|style)>/iu.test(line)
    ) {
      state.inBlock = true;
      return '';
    }
  }
  return line;
}

function markersOn(line: string) {
  return [...line.matchAll(OBJECTION_MARKER)].map(
    (match) => match[1] ?? match[2] ?? '',
  );
}

/**
 * Flags published copy that answers an objection nobody has raised, unless
 * the line (or the one above it) carries a marker naming a ledger row.
 */
export async function validateObjectionCopy(
  issues: string[],
  root = repoRoot,
  files?: string[],
) {
  let ledger = new Set<string>();
  try {
    ledger = parseObjectionLedger(
      await fs.readFile(path.join(root, OBJECTION_LEDGER), 'utf8'),
    );
  } catch {
    issues.push(
      `${OBJECTION_LEDGER} is missing; the objection markers name its rows.`,
    );
  }

  for (const file of files ?? (await collectPublishedCopy(root))) {
    let contents: string;
    try {
      contents = await fs.readFile(path.join(root, file), 'utf8');
    } catch {
      continue;
    }
    const lines = contents.split('\n');
    const state = { inBlock: false };

    lines.forEach((line, index) => {
      for (const id of markersOn(line)) {
        if (!ledger.has(id)) {
          issues.push(
            `${file}:${index + 1} names objection "${id}", which has no row in ${OBJECTION_LEDGER}. Add the row with its evidence, or remove the marker.`,
          );
        }
      }

      const text = visibleText(file, line, state);
      if (!text) return;
      for (const { kind, pattern } of PRESUPPOSING_COPY) {
        const match = pattern.exec(text);
        if (!match) continue;
        const marked = [
          ...markersOn(line),
          ...markersOn(lines[index - 1] ?? ''),
        ];
        if (marked.some((id) => ledger.has(id))) continue;
        issues.push(
          `${file}:${index + 1} answers an objection no visitor has raised (${kind}: "${match[0].trim()}"). Say what the thing does instead, or, if a visitor did raise it, add a row to ${OBJECTION_LEDGER} and mark the line with its id.`,
        );
      }
    });
  }
}

export async function runReadmeClaimChecks(root = repoRoot) {
  const issues: string[] = [];
  await validateReadmeProductClaims(issues, root);
  await validateDocumentedClaims(issues, root);
  await validateObjectionCopy(issues, root);
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
