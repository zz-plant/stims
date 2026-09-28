/**
 * Audits the *served* preview for every catalogued preset and reports the
 * two failure classes that look fine on a 200 but break a share card:
 *
 * 1. unusable  — production serves a black/flat capture. Judged with the
 *    generator's own badFrameReason(), never a bespoke luma threshold:
 *    sparse-bright presets are legitimately dark, and a mean-only check
 *    flags them all as broken.
 * 2. stale     — production serves a capture the repo no longer has, or
 *    serves a materially worse one (lower frameScore). These are not
 *    broken, they are just old, and the fix is an upload, not a recapture.
 *
 * Class 2 needs no local regeneration at all, which is the point: recapturing
 * is minutes-to-hours of browser sim per preset, uploading is one request.
 *
 * Usage:
 *   bun run scripts/audit-production-previews.ts [--sample N] [--concurrency N] [--stale-only]
 * Env: PREVIEW_BASE (default https://toil.fyi), CATALOG_URL
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  analyzeFrame,
  badFrameReason,
  type FrameStats,
  frameScore,
} from './frame-stats.ts';

type Catalog = {
  presets: Array<{ id: string; preview?: boolean }>;
};

type Preset = Catalog['presets'][number];

export type PreviewVerdictKind =
  | 'upload'
  | 'recapture'
  | 'regression'
  | 'missing-local';

/**
 * The auditable set, in catalog order: everything the catalog still offers a
 * preview for. `preview: false` is how the catalog marks a preset whose
 * capture failed, so auditing one would only ever report the file it already
 * knows is absent.
 *
 * `sampleSize` takes a deterministic stride rather than a random subset so two
 * runs over the same catalog request the same ids — a re-run after an upload
 * has to be comparable with the run that prompted it.
 */
export function selectPreviewIds(presets: Preset[], sampleSize = 0): string[] {
  const all = presets.filter((p) => p.preview !== false).map((p) => p.id);
  if (!(sampleSize > 0) || sampleSize >= all.length) return all;
  const stride = all.length / sampleSize;
  return Array.from(
    { length: sampleSize },
    (_, i) => all[Math.floor(i * stride)],
  );
}

/**
 * What the run should do about one served preview, judged against the repo's
 * copy rather than in isolation.
 *
 * The two failure classes look the same from outside — a share card is wrong
 * either way — but they cost wildly different amounts to fix, and telling them
 * apart is the reason this script exists. Uploading is one request; a
 * recapture is minutes-to-hours of browser sim per preset, so an unusable
 * served frame must be labelled `recapture` only when the repo copy is
 * unusable too. Classifying it `upload` would send an operator to re-upload a
 * black picture and change nothing.
 *
 * Returns null when production already serves the repo's capture.
 */
export function classifyPreview(
  prodStats: FrameStats,
  localStats: FrameStats | null,
): { kind: PreviewVerdictKind; detail: string } | null {
  const prodBad = badFrameReason(prodStats);
  if (prodBad) {
    const localBad = localStats ? badFrameReason(localStats) : null;
    return {
      kind: localStats && !localBad ? 'upload' : 'recapture',
      detail: `served ${prodBad}; repo ${
        localStats
          ? (localBad ?? `ok (${frameScore(localStats).toFixed(1)})`)
          : 'missing'
      }`,
    };
  }
  if (!localStats) {
    return {
      kind: 'missing-local',
      detail: 'served, but no capture in the repo',
    };
  }
  if (localStats.hash === prodStats.hash) return null;

  // Only an upgrade is worth publishing: the generator's checkpoint search is a
  // plateau search, so a fresh capture can be worse than the one on disk.
  // Uploading a regression would trade a stale card for a worse one.
  const prodScore = frameScore(prodStats);
  const localScore = frameScore(localStats);
  return {
    kind: localScore > prodScore ? 'upload' : 'regression',
    detail: `served ${prodScore.toFixed(1)} vs repo ${localScore.toFixed(1)}`,
  };
}

const argOf = (args: string[], flag: string, fallback: number) => {
  const i = args.indexOf(flag);
  if (i === -1) return fallback;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) ? n : fallback;
};

const localDir = join('public', 'milkdrop-presets', 'previews');

type Finding = {
  id: string;
  /**
   * upload     — served copy is worse than the repo's; publish the repo's
   * recapture   — served copy is black/flat and so is the repo's; only a
   *              new capture fixes it
   * regression — served copy differs and the repo's scores *worse*; leave
   *              production alone
   * missing-local / http — nothing to compare or nothing served
   */
  kind: PreviewVerdictKind | 'http';
  detail: string;
  prodStats: FrameStats | null;
  localStats: FrameStats | null;
};

async function main() {
  const args = process.argv.slice(2);
  const sampleSize = argOf(args, '--sample', 0);
  const concurrency = argOf(args, '--concurrency', 12);
  const base = (process.env.PREVIEW_BASE || 'https://toil.fyi').replace(
    /\/$/,
    '',
  );

  const catalog: Catalog = await fetch(
    process.env.CATALOG_URL || `${base}/milkdrop-presets/catalog.json`,
  ).then((r) => r.json());

  const ids = selectPreviewIds(catalog.presets, sampleSize);

  console.log(
    `Auditing ${ids.length} served previews (concurrency ${concurrency})\n`,
  );

  const findings: Finding[] = [];
  let checked = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      const url = `${base}/milkdrop-presets/previews/${encodeURIComponent(id)}.png`;

      let prodStats: FrameStats | null = null;
      try {
        const res = await fetch(url);
        if (res.status !== 200) {
          findings.push({
            id,
            kind: 'http',
            detail: `HTTP ${res.status}`,
            prodStats: null,
            localStats: null,
          });
          continue;
        }
        const body = Buffer.from(await res.arrayBuffer());
        prodStats = await analyzeFrame(body);
      } catch (err) {
        findings.push({
          id,
          kind: 'http',
          detail: `fetch failed: ${err}`,
          prodStats: null,
          localStats: null,
        });
        continue;
      }

      const localPath = join(localDir, `${id}.png`);
      const localStats = existsSync(localPath)
        ? await analyzeFrame(
            Buffer.from(await Bun.file(localPath).arrayBuffer()),
          )
        : null;

      const verdict = classifyPreview(prodStats, localStats);
      if (verdict) findings.push({ id, ...verdict, prodStats, localStats });

      if (++checked % 200 === 0) console.log(`  … ${checked}/${ids.length}`);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, ids.length) }, worker),
  );

  const byKind = (kind: Finding['kind']) =>
    findings.filter((f) => f.kind === kind);

  /**
   * `--format ids` emits `kind<TAB>id` per line so the sweep can drive an
   * upload without a human retyping the table. `--kind upload` is the safe
   * publish set: strictly-better repo captures, nothing else.
   */
  const format = argOf(args, '--format', 0) === 1 ? 'ids' : 'table';
  const kindArgIndex = args.indexOf('--kind');
  const only =
    kindArgIndex === -1
      ? null
      : (args[kindArgIndex + 1] as Finding['kind'] | undefined);

  if (format === 'ids') {
    for (const kind of only ? [only] : KIND_ORDER) {
      for (const f of byKind(kind)) console.log(`${kind}\t${f.id}`);
    }
    return;
  }

  console.log(`\nAudited ${ids.length} served previews.`);
  for (const kind of KIND_ORDER) {
    console.log(`  ${kind.padEnd(13)} ${byKind(kind).length}`);
  }

  if (findings.length > 0) {
    for (const kind of KIND_ORDER) {
      const rows = byKind(kind);
      if (rows.length === 0) continue;
      console.log(`\n## ${kind} (${rows.length})`);
      for (const f of rows.slice(0, 40)) {
        console.log(`  ${f.id}\t${f.detail}`);
      }
      if (rows.length > 40) {
        console.log(`  … ${rows.length - 40} more`);
      }
    }
    console.log(
      '\nupload: publish the repo capture (bun run previews:sync, or\n' +
        '        bun run scripts/audit-production-previews.ts --format ids --kind upload).',
    );
    console.log(
      'recapture: black/flat in production AND in the repo — needs a new capture.',
    );
    console.log(
      'regression: the repo capture scores worse; production is left alone.',
    );
  }
}

const KIND_ORDER: Finding['kind'][] = [
  'upload',
  'recapture',
  'regression',
  'missing-local',
  'http',
];

// Guarded so the classification can be unit-tested without the module's
// top-level catalog fetch kicking off a full sweep on import.
if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
