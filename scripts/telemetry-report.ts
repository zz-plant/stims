// Queries the stims_telemetry Analytics Engine dataset via Cloudflare's SQL API
// and prints a few aggregate reports. AE is currently write-only (see
// functions/api/telemetry.ts) — this is the read half.
//
// Requires CLOUDFLARE_API_TOKEN (Account Analytics:Read) and
// CLOUDFLARE_ACCOUNT_ID, the same env vars wrangler itself uses.
//
// Usage: bun run telemetry:report [--days=7]

export {};

const DATASET = 'stims_telemetry';

// Falls back to the OAuth token `wrangler login` already stored, so
// `bun run telemetry:report` works out of the box for anyone who has
// authorized wrangler in this repo — no separate API token needed.
async function resolveCredentials(): Promise<{
  accountId: string;
  token: string;
} | null> {
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) {
    return {
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      token: process.env.CLOUDFLARE_API_TOKEN,
    };
  }

  try {
    const configPath = `${process.env.HOME}/.wrangler/config/default.toml`;
    const toml = await Bun.file(configPath).text();
    const token = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
    if (!token) return null;

    const whoami = await fetch(
      'https://api.cloudflare.com/client/v4/accounts',
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!whoami.ok) return null;
    const body = (await whoami.json()) as { result?: { id: string }[] };
    const accountId = body.result?.[0]?.id;
    if (!accountId) return null;

    return { accountId, token };
  } catch {
    return null;
  }
}

// blobs: [event, renderer, presetId, error, country]
// doubles: [fps, audioLatencyMs, timestamp, dwellMs]
// indexes: [event]

interface Report {
  title: string;
  sql: string;
  columns: string[];
}

function buildReports(days: number): Report[] {
  const since = `NOW() - INTERVAL '${days}' DAY`;
  return [
    {
      title: `Events by type (last ${days}d)`,
      sql: `SELECT blob1 AS event, COUNT() AS count FROM ${DATASET}
            WHERE timestamp > ${since}
            GROUP BY blob1 ORDER BY count DESC LIMIT 20`,
      columns: ['event', 'count'],
    },
    {
      title: `Presets with the most errors (last ${days}d)`,
      sql: `SELECT blob3 AS presetId, blob4 AS error, COUNT() AS count FROM ${DATASET}
            WHERE timestamp > ${since} AND blob1 = 'error' AND blob3 != ''
            GROUP BY blob3, blob4 ORDER BY count DESC LIMIT 20`,
      columns: ['presetId', 'error', 'count'],
    },
    {
      title: `Renderer split (last ${days}d)`,
      sql: `SELECT blob2 AS renderer, COUNT() AS count FROM ${DATASET}
            WHERE timestamp > ${since}
            GROUP BY blob2 ORDER BY count DESC`,
      columns: ['renderer', 'count'],
    },
    {
      // AE's SQL dialect has no quantile/median function, so this reports
      // min/avg/max rather than true percentiles.
      title: `FPS range by renderer (last ${days}d)`,
      sql: `SELECT blob2 AS renderer,
                   COUNT() AS samples,
                   MIN(double1) AS min_fps,
                   AVG(double1) AS avg_fps,
                   MAX(double1) AS max_fps
            FROM ${DATASET}
            WHERE timestamp > ${since} AND double1 > 0
            GROUP BY blob2 ORDER BY samples DESC`,
      columns: ['renderer', 'samples', 'min_fps', 'avg_fps', 'max_fps'],
    },
    {
      // Engagement per preset: views vs quick skips and average dwell.
      // To feed curation, save these rows as JSON at
      // scratch/preset-engagement.json and re-run `bun run catalog:score`.
      title: `Preset engagement (last ${days}d)`,
      sql: `SELECT blob3 AS presetId,
                   COUNT() AS events,
                   SUM(IF(blob1 = 'preset-skip', 1, 0)) AS skips,
                   AVG(double4) AS avg_dwell_ms
            FROM ${DATASET}
            WHERE timestamp > ${since}
              AND blob1 IN ('preset-dwell', 'preset-skip')
              AND blob3 != ''
            GROUP BY blob3 ORDER BY events DESC LIMIT 100`,
      columns: ['presetId', 'events', 'skips', 'avg_dwell_ms'],
    },
    {
      // Substitutions (noteSubstitution, preset-telemetry.ts, added 2026-08-18):
      // the app showed something other than what was asked for — a fallback
      // preset replaced a deep link, the renderer fell back to WebGL, or a
      // requested preset failed outright. These are invisible to visitors
      // (no error surfaces beyond a transient toast), so this is the only
      // signal for how often a Google-search or shared-link arrival gets a
      // different experience than the one that was promised.
      title: `Substitutions by kind (last ${days}d)`,
      sql: `SELECT blob1 AS event, COUNT() AS count FROM ${DATASET}
            WHERE timestamp > ${since} AND blob1 LIKE 'substitution-%'
            GROUP BY blob1 ORDER BY count DESC`,
      columns: ['event', 'count'],
    },
    {
      title: `Substitution detail, most frequent (last ${days}d)`,
      sql: `SELECT blob1 AS event, blob4 AS detail, COUNT() AS count FROM ${DATASET}
            WHERE timestamp > ${since} AND blob1 LIKE 'substitution-%'
            GROUP BY blob1, blob4 ORDER BY count DESC LIMIT 30`,
      columns: ['event', 'detail', 'count'],
    },
  ];
}

function printTable(columns: string[], rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    console.log('  (no rows)');
    return;
  }
  const widths = columns.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(`  ${line(columns)}`);
  console.log(`  ${line(widths.map((w) => '-'.repeat(w)))}`);
  for (const row of rows) {
    console.log(`  ${line(columns.map((c) => String(row[c] ?? '')))}`);
  }
}

async function runQuery(
  sql: string,
  creds: { accountId: string; token: string },
): Promise<Record<string, unknown>[]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'text/plain',
      },
      body: sql,
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AE SQL API ${res.status}: ${body.slice(0, 500)}`);
  }

  const json = (await res.json()) as { data?: Record<string, unknown>[] };
  return json.data ?? [];
}

async function main() {
  const creds = await resolveCredentials();
  if (!creds) {
    console.error(
      'No usable Cloudflare credentials found.\n' +
        'Either run `bunx wrangler login`, or set CLOUDFLARE_ACCOUNT_ID and ' +
        'CLOUDFLARE_API_TOKEN (needs Account Analytics:Read permission).',
    );
    process.exit(1);
  }

  const daysArg = process.argv.find((a) => a.startsWith('--days='));
  const days = daysArg ? Number(daysArg.split('=')[1]) : 7;

  for (const report of buildReports(days)) {
    console.log(`\n${report.title}`);
    try {
      const rows = await runQuery(report.sql, creds);
      printTable(report.columns, rows);
    } catch (err) {
      console.log(
        `  query failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

main();
