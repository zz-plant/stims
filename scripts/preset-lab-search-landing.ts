/**
 * Measures what a visitor arriving from search sees on each preset's page, and records the presets whose landing shows nothing.
 *
 * Search engines are offered catalog presets as `/?preset=<id>` (see
 * `buildPresetSitemapEntries` in generate-seo.ts). A visitor who clicks one
 * lands cold: no gesture yet, so Chrome holds the demo audio and the preset
 * runs on silence. On 2026-10-07, 13 of 40 random sitemap presets showed
 * under 0.5% lit pixels on WebGPU at that moment, a frame nobody can tell from
 * a failed page, and tapping for sound changed only one of them.
 *
 * Each preset loads in a fresh browser context, without agent mode and with
 * Chrome's real autoplay gate, the way a search arrival does. The stage
 * canvas is captured alone at two points after navigation, and the recorded
 * value is the larger lit ratio of the two, so a preset that fades in is not
 * judged on its first frame. Concurrent captures contend for the GPU and can
 * read black, so every blank from the concurrent pass is measured again on
 * its own before it is recorded.
 *
 * Results merge into src/data/search-landing-evidence.json one backend at a
 * time. `generate:seo` keeps presets that land blank on either backend out of
 * the sitemap, and the edge middleware marks their pages noindex.
 *
 *   bun run lab:search-landing -- --backend webgpu
 *   bun run lab:search-landing -- --backend webgl --resume
 *   bun run lab:search-landing -- --backend webgpu --preset orb-quicksand --dry-run
 *
 * Flags: `--base <url>` measures an already running site instead of building
 * and serving dist/ (set STIMS_REUSE_DIST=1 to skip the rebuild), `--limit`,
 * `--concurrency` (default 3), `--viewport 390x844`, `--channel`.
 *
 * Uses installed Google Chrome by default. Playwright's bundled Chromium 153
 * rejects the WebGPU composite pipeline (a Tint "swizzle view" error) and
 * reads every WebGPU preset as black.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium } from 'playwright';
import sharp from 'sharp';
import { ensureProductionServer } from './dev-server.ts';
import { readUniqueCatalogPresets } from './generate-seo.ts';
import { captureIsolatedVisualizerCanvas } from './run-milkdrop-loop-visual-sweep.ts';
import {
  LIT_LUMINANCE,
  LIT_RATIO_FLOOR,
  measurementKey,
  readSearchLandingEvidence,
  type SearchLandingBackend,
  type SearchLandingMeasurement,
  writeSearchLandingEvidence,
} from './search-landing-evidence.ts';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

type AgentWindow = Window & {
  __stims_agent?: {
    getState: () => { engineState?: string; presetId?: string | null };
  };
};

/** Sample points after navigation. The first is the visitor's first look. */
const SAMPLE_AT_MS = [5000, 9000] as const;
const LIVE_TIMEOUT_MS = 20_000;
const PHONE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36';
const DEFAULT_PORT = 4176;
const SAVE_EVERY = 25;

type Options = {
  backend: SearchLandingBackend;
  presets: string[];
  limit: number | null;
  concurrency: number;
  resume: boolean;
  dryRun: boolean;
  base: string | null;
  viewport: { width: number; height: number };
  channel: string;
};

function parseArgs(argv: string[]): Options {
  const value = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const backend = value('--backend') ?? 'webgpu';
  if (backend !== 'webgpu' && backend !== 'webgl') {
    throw new Error(`--backend must be webgpu or webgl, got ${backend}`);
  }
  const [width, height] = (value('--viewport') ?? '1280x720')
    .split('x')
    .map(Number);
  const presets: string[] = [];
  argv.forEach((arg, index) => {
    if (arg === '--preset' && argv[index + 1]) presets.push(argv[index + 1]);
  });
  return {
    backend,
    presets,
    limit: value('--limit') ? Number(value('--limit')) : null,
    concurrency: Number(value('--concurrency') ?? 3),
    resume: argv.includes('--resume'),
    dryRun: argv.includes('--dry-run'),
    base: value('--base') ?? null,
    viewport: { width: width || 1280, height: height || 720 },
    channel: value('--channel') ?? 'chrome',
  };
}

async function litRatio(png: Buffer) {
  const { data, info } = await sharp(png)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let lit = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const luminance =
      (data[offset] ?? 0) * 0.2126 +
      (data[offset + 1] ?? 0) * 0.7152 +
      (data[offset + 2] ?? 0) * 0.0722;
    if (luminance > LIT_LUMINANCE) lit += 1;
  }
  return lit / (info.width * info.height);
}

async function measureLanding(
  browser: Browser,
  options: Options,
  baseUrl: string,
  presetId: string,
): Promise<SearchLandingMeasurement> {
  // A viewport this narrow is measured as the phone it stands for: the app
  // detects touch devices and caps pixel ratio and quality for them.
  const phone = Math.min(options.viewport.width, options.viewport.height) < 600;
  const context = await browser.newContext({
    viewport: options.viewport,
    ...(phone
      ? {
          isMobile: true,
          hasTouch: true,
          deviceScaleFactor: 3,
          userAgent: PHONE_USER_AGENT,
        }
      : {}),
  });
  try {
    const page = await context.newPage();
    const url = new URL('/', baseUrl);
    url.searchParams.set('preset', presetId);
    if (options.backend === 'webgl') url.searchParams.set('renderer', 'webgl');
    const startedAt = Date.now();
    await page.goto(url.toString(), { waitUntil: 'commit' });
    try {
      await page.waitForFunction(
        () =>
          (window as AgentWindow).__stims_agent?.getState().engineState ===
          'live',
        undefined,
        { timeout: LIVE_TIMEOUT_MS },
      );
    } catch {
      return 'timeout';
    }
    let best = 0;
    for (const at of SAMPLE_AT_MS) {
      await page.waitForTimeout(Math.max(0, at - (Date.now() - startedAt)));
      const shown = await page.evaluate(
        () =>
          (window as AgentWindow).__stims_agent?.getState().presetId ?? null,
      );
      if (shown !== presetId) return `substituted:${shown}`;
      best = Math.max(
        best,
        await litRatio(await captureIsolatedVisualizerCanvas(page)),
      );
    }
    return Math.round(best * 10_000) / 10_000;
  } finally {
    await context.close();
  }
}

function isBlank(value: SearchLandingMeasurement) {
  return typeof value === 'string' || value < LIT_RATIO_FLOOR;
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  run: (item: T) => Promise<void>,
) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        await run(item);
      }
    }),
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const evidence = readSearchLandingEvidence(repoRoot) ?? {
    measuredAt: '',
    method: '',
    presets: {},
  };

  let ids = options.presets.length
    ? options.presets
    : (await readUniqueCatalogPresets(repoRoot)).map((preset) => preset.id);
  const key = measurementKey(
    options.backend,
    `${options.viewport.width}x${options.viewport.height}`,
  );
  if (options.resume) {
    ids = ids.filter((id) => evidence.presets[id]?.[key] === undefined);
  }
  if (options.limit !== null) ids = ids.slice(0, options.limit);

  const server = options.base
    ? null
    : await ensureProductionServer(DEFAULT_PORT, repoRoot);
  const baseUrl = options.base ?? `http://127.0.0.1:${DEFAULT_PORT}`;
  const browser = await chromium.launch({
    channel: options.channel,
    headless: true,
    args: ['--autoplay-policy=user-gesture-required', '--ignore-gpu-blocklist'],
  });

  const results = new Map<string, SearchLandingMeasurement>();
  const save = () => {
    if (options.dryRun) return;
    for (const [id, value] of results) {
      evidence.presets[id] = { ...evidence.presets[id], [key]: value };
    }
    evidence.measuredAt = new Date().toISOString().slice(0, 10);
    evidence.method =
      `Cold context, no agent mode, audio held for a gesture; keys are the ` +
      `backend at 1280x720 or <backend>@<viewport>; larger lit ratio ` +
      `(luminance > ${LIT_LUMINANCE}) of stage captures at ` +
      `${SAMPLE_AT_MS.map((ms) => `${ms / 1000}s`).join(' and ')}; ` +
      `blanks confirmed by a serial re-measure.`;
    writeSearchLandingEvidence(evidence, repoRoot);
  };

  try {
    console.log(
      `Measuring ${ids.length} preset landings as ${key} at ${baseUrl}`,
    );
    let done = 0;
    await runPool(ids, options.concurrency, async (id) => {
      results.set(
        id,
        await measureLanding(browser, options, baseUrl, id).catch(
          () => 'timeout',
        ),
      );
      done += 1;
      if (done % SAVE_EVERY === 0) {
        save();
        console.log(`  ${done}/${ids.length}`);
      }
    });

    const blanks = [...results]
      .filter(([, value]) => isBlank(value))
      .map(([id]) => id);
    console.log(`Re-measuring ${blanks.length} blank landings one at a time`);
    for (const id of blanks) {
      results.set(
        id,
        await measureLanding(browser, options, baseUrl, id).catch(
          () => 'timeout',
        ),
      );
    }
    save();

    const confirmed = [...results].filter(([, value]) => isBlank(value));
    console.log(
      `${confirmed.length} of ${results.size} land blank as ${key} ` +
        `(under ${LIT_RATIO_FLOOR * 100}% lit, or never shown)`,
    );
    if (options.dryRun || confirmed.length <= 40) {
      for (const [id, value] of confirmed) console.log(`  ${id}: ${value}`);
    }
  } finally {
    await browser.close();
    server?.close();
  }
}

if (import.meta.main) {
  await main();
}
