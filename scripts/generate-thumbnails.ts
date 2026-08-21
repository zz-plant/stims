/**
 * Batch preview generator — renders presets via Playwright + WebGL.
 *
 * Rather than waiting wall-clock time for presets to warm up, each preset is
 * rendered by synchronously pumping simulation frames through the engine's
 * agent hook (window.__STIMS_AGENT_RENDER_FRAMES__), then reading the canvas
 * framebuffer directly with toDataURL. No audio is started — the engine's
 * synthetic preview signal (a pure function of frame time) drives visuals,
 * so captures are fast, reproducible, and immune to RAF pauses. toDataURL
 * reads the framebuffer, not the composited page, so UI overlays can never
 * contaminate a capture.
 *
 * Black or byte-duplicate captures are never written: a stalled renderer
 * fails loudly (preview-failures.json) instead of poisoning the output dir.
 *
 * Usage:
 *   bun run scripts/generate-thumbnails.ts              # missing previews (up to --limit)
 *   bun run scripts/generate-thumbnails.ts --count=100  # first N missing
 *   bun run scripts/generate-thumbnails.ts --ids=geiss-casino,flexi-dawn
 *   bun run scripts/generate-thumbnails.ts --ids-file=path/to/ids.txt
 *   bun run scripts/generate-thumbnails.ts --all         # all presets
 *   bun run scripts/generate-thumbnails.ts --force       # overwrite existing
 *   bun run scripts/generate-thumbnails.ts --force --keep-best  # re-sweep, keep the better frame
 *   bun run scripts/generate-thumbnails.ts --beat-pulse  # 2Hz beats in the synthetic signal
 *   bun run scripts/generate-thumbnails.ts --workers=8   # concurrency
 *   bun run scripts/generate-thumbnails.ts --port=5178   # dedicated dev server
 *   bun run scripts/generate-thumbnails.ts --no-headless # visible windows (debugging)
 *
 * Requires: Playwright Chromium installed. Dev server is started automatically.
 * Outputs: public/milkdrop-presets/previews/{presetId}.png (480×270)
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { type BrowserContext, chromium } from 'playwright';
import sharp from 'sharp';
import { ensureDevServer } from './dev-server.ts';

const OUTPUT_DIR = 'public/milkdrop-presets/previews';
const LIBRARIES_DIR = 'public/milkdrop-presets/libraries';
const PREVIEW_W = 480;
const PREVIEW_H = 270;
const DEFAULT_LIMIT = 50;
const DEFAULT_WORKERS = 8;
const DEFAULT_PORT = 5173;
// Simulated-frame budget per capture attempt (60fps sim time). Feedback
// presets need seconds of accumulation to show structure, but too much
// accumulation saturates additive presets to solid white — so the page
// checkpoints every CHECK_EVERY frames and captures the first good frame.
// Fast-saturating presets blow out to white within a second of sim time,
// so checkpoints start at 15 frames and sample finely early on.
const MIN_FRAMES = 15;
const MAX_FRAMES = 600;
/** Checkpoints without a better frame before the search is considered done. */
const PLATEAU_CHECKPOINTS = 3;
const MAX_RETRIES = 1;
// Generous under load: 8 workers can stampede compiles + Vite transforms,
// especially while every page boots at once.
const BOOT_TIMEOUT_MS = 45000;
const SWAP_TIMEOUT_MS = 45000;
const PER_PRESET_TIMEOUT_MS = 120000;
// The stage is inset in home-mode layout (~65% of viewport), so the
// viewport must be larger than the target size for the stage framebuffer
// to exceed 480px; the readback is downscaled to the output size.
const CAPTURE_VIEWPORT = { width: 960, height: 540 };
// Recycle the long-lived page periodically so leaked GL resources from
// hundreds of preset compiles can't degrade later captures.
const PAGE_RECYCLE_EVERY = 100;

interface PresetEntry {
  id: string;
  title: string;
  preview?: unknown;
}

type CaptureFailure = {
  presetId: string;
  reason: string;
};

function parseArgs() {
  const args: {
    count?: number;
    ids?: string[];
    all?: boolean;
    force?: boolean;
    headless?: boolean;
    workers?: number;
    port?: number;
    beatPulse?: boolean;
    keepBest?: boolean;
    // Headless by default: launched via the 'chromium' channel
    // (--headless=new), captures still render on the real GPU, and the
    // whole window-occlusion problem class disappears. --no-headless
    // restores visible windows for debugging a capture.
  } = { headless: true };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--count=')) args.count = parseInt(arg.slice(8), 10);
    if (arg.startsWith('--ids=')) args.ids = arg.slice(6).split(',');
    if (arg.startsWith('--ids-file='))
      args.ids = readFileSync(arg.slice(11), 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    if (arg === '--all') args.all = true;
    if (arg === '--force') args.force = true;
    if (arg.startsWith('--workers='))
      args.workers = parseInt(arg.slice(10), 10);
    if (arg.startsWith('--port=')) args.port = parseInt(arg.slice(7), 10);
    if (arg === '--headless' || arg === '--headless=true') args.headless = true;
    if (arg === '--headless=false' || arg === '--no-headless')
      args.headless = false;
    // Overlay deterministic 2Hz beats on the synthetic audio — lights up
    // beat-gated presets that stay dark under the smooth idle signal.
    if (arg === '--beat-pulse') args.beatPulse = true;
    // Only replace an existing preview when the fresh capture scores better.
    // Makes a corpus-wide --force re-sweep monotonic (see the write site).
    if (arg === '--keep-best') args.keepBest = true;
  }
  return args;
}

/**
 * Every preset the app can browse, main catalog plus the bundled libraries.
 *
 * The libraries (projectm-cream-of-the-crop, projectm-upstream) carry their
 * own catalog.json and are ~a third of the browsable catalog, but this script
 * only ever read the root catalog — so those presets could never get a
 * preview, and browse rendered them as empty tiles. PresetArtwork resolves
 * preview art by convention (`previews/{id}.png`), so a generated file is all
 * they need; no catalog entry has to change.
 */
async function loadAllCatalogEntries(): Promise<PresetEntry[]> {
  // Libraries are discovered by directory, matching loadCatalogEntries in
  // preset-lab-reactivity.ts, so a newly vendored library needs no edit here.
  const librariesRoot = new URL(`../${LIBRARIES_DIR}/`, import.meta.url);
  const libraryCatalogs = existsSync(librariesRoot)
    ? readdirSync(librariesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => new URL(`${entry.name}/catalog.json`, librariesRoot))
    : [];
  const catalogUrls = [
    new URL('../public/milkdrop-presets/catalog.json', import.meta.url),
    ...libraryCatalogs,
  ];
  const entries: PresetEntry[] = [];
  const seen = new Set<string>();
  for (const url of catalogUrls) {
    if (!existsSync(url)) continue;
    const data = await Bun.file(url).json();
    if (!Array.isArray(data.presets)) continue;
    for (const preset of data.presets as PresetEntry[]) {
      if (seen.has(preset.id)) continue;
      seen.add(preset.id);
      entries.push(preset);
    }
  }
  return entries;
}

/**
 * `preview` is an opt-OUT flag: it is `true` on all but one root-catalog entry
 * and absent entirely on library entries, so only an explicit `false` skips.
 */
function wantsPreview(preset: PresetEntry): boolean {
  return preset.preview !== false;
}

async function getPresets(filter: {
  count?: number;
  ids?: string[];
  all?: boolean;
  force?: boolean;
}): Promise<PresetEntry[]> {
  const all = await loadAllCatalogEntries();

  if (filter.ids) {
    const idSet = new Set(filter.ids);
    return all.filter((p) => idSet.has(p.id));
  }

  if (filter.all) {
    return filter.force
      ? all
      : all.filter((p) => !existsSync(join(OUTPUT_DIR, `${p.id}.png`)));
  }

  const limit = filter.count ?? DEFAULT_LIMIT;
  if (filter.force) {
    return all.filter(wantsPreview).slice(0, limit);
  }

  return all
    .filter(
      (p) => wantsPreview(p) && !existsSync(join(OUTPUT_DIR, `${p.id}.png`)),
    )
    .slice(0, limit);
}

type FrameStats = {
  /** sha256 of the raw pixel buffer — byte-identical captures collide. */
  hash: string;
  meanLuma: number;
  maxLuma: number;
  stdLuma: number;
  /** Fraction of pixels clipped to white — high std is worthless if clipped. */
  blownFraction: number;
};

async function analyzeFrame(buffer: Buffer): Promise<FrameStats> {
  const { data, info } = await sharp(buffer)
    .resize(96, 54)
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  let sumSq = 0;
  let max = 0;
  let blown = 0;
  const pixels = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    const luma =
      0.299 * data[i] + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
    sum += luma;
    sumSq += luma * luma;
    if (luma > max) max = luma;
    if (
      data[i] >= 250 &&
      (data[i + 1] ?? 0) >= 250 &&
      (data[i + 2] ?? 0) >= 250
    ) {
      blown += 1;
    }
  }
  const mean = sum / pixels;
  return {
    hash: createHash('sha256').update(data).digest('hex'),
    blownFraction: blown / pixels,
    meanLuma: mean,
    maxLuma: max,
    stdLuma: Math.sqrt(Math.max(0, sumSq / pixels - mean * mean)),
  };
}

/**
 * Useless as a preview: pure black, near-black noise, or a flat solid
 * color (including feedback loops blown out to solid white). Sparse-bright
 * presets (a few glowing shapes on black) are legitimate, so a low mean is
 * only fatal when nothing bright exists either.
 */
// The same score the in-page checkpoint search maximizes. Structure (std) is
// what makes a thumbnail readable, scaled down for frames that are technically
// lit but almost empty, penalized for clipping (a white blob on black scores
// enormous std while showing nothing), and zeroed at both failure ends.
function frameScore(stats: FrameStats): number {
  if (stats.maxLuma < 32 || stats.meanLuma > 240) return 0;
  return (
    stats.stdLuma *
    Math.min(1, stats.meanLuma / 8) *
    (1 - Math.min(1, stats.blownFraction)) ** 2
  );
}

function badFrameReason(stats: FrameStats): string | null {
  if (stats.maxLuma < 32 || stats.meanLuma < 0.4) {
    return `black frame (mean=${stats.meanLuma.toFixed(1)}, max=${stats.maxLuma.toFixed(0)})`;
  }
  if (stats.stdLuma < 2.5) {
    return `flat frame (mean=${stats.meanLuma.toFixed(1)}, std=${stats.stdLuma.toFixed(1)})`;
  }
  return null;
}

async function writePreview(buffer: Buffer, filePath: string): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await sharp(buffer)
    .resize(PREVIEW_W, PREVIEW_H, { fit: 'cover', position: 'center' })
    .png({ compressionLevel: 6 })
    .toFile(tmpPath);
  renameSync(tmpPath, filePath);
}

/**
 * A long-lived page that boots the app once in agent mode (no audio), then
 * hot-swaps presets via the agent bridge (toil:load_preset) and steps
 * simulation frames manually. Transition mode is forced to 'cut' so swaps
 * are instant instead of a multi-second crossfade.
 */
class RenderSession {
  private page: Awaited<ReturnType<BrowserContext['newPage']>> | null = null;
  rendered = 0;

  constructor(
    private ctx: BrowserContext,
    private devServer: string,
    /**
     * presetId by capture hash, shared across the whole run — different
     * presets must never produce byte-identical captures.
     */
    private seenHashes: Map<string, string>,
    /** All catalog ids, used to pick a sacrificial boot preset. */
    private catalogIds: string[],
    private beatPulse: boolean,
    private keepBest: boolean,
    private tally: { kept: number; improved: number },
  ) {}

  private async boot(firstTargetId: string) {
    const page = await this.ctx.newPage();
    // The engine only mounts when the route carries a preset (or an audio
    // source), so the boot URL needs ?preset=. But it must NOT be the
    // preset we're about to capture: the stage mounts on a route *change*,
    // and load_preset for the id already in the route is a no-op commit.
    // Boot with any other catalog preset, then swap to the real target.
    const bootId =
      this.catalogIds.find((id) => id !== firstTargetId) ?? firstTargetId;
    // lockQualityStep pins the adaptive-quality controller to the sharpest
    // step — boot cost otherwise degrades it, shrinking the framebuffer.
    await page.goto(
      `${this.devServer}/?preset=${bootId}&agent=true&renderer=webgl&lockQualityStep=0&audio=none`,
      { waitUntil: 'domcontentloaded' },
    );
    // The engine session installs the render hook once the runtime mounts.
    await page.waitForFunction(
      () => typeof window.__STIMS_AGENT_RENDER_FRAMES__ === 'function',
      undefined,
      { timeout: BOOT_TIMEOUT_MS },
    );
    this.page = page;
    return page;
  }

  async close() {
    if (this.page) await this.page.close().catch(() => {});
    this.page = null;
  }

  async render(preset: PresetEntry): Promise<void> {
    const page = this.page ?? (await this.boot(preset.id));

    // window.stims.agent.selectPreset calls straight through to the
    // navigation controller (bypassing route/URL state and the postMessage
    // bridge), and its promise only resolves once the controller's own
    // supersede/fallback handling has settled — so a bad id or a dropped
    // bridge message surfaces immediately as `applied: false` instead of
    // silently eating the full SWAP_TIMEOUT_MS. The stage canvas still needs
    // its own check: it sizes on its own render cycle after the preset
    // state flips (identicon canvases are 56×56; the stage is
    // viewport-sized).
    const result = await page.evaluate(
      (presetId) => window.stims?.agent?.selectPreset(presetId),
      preset.id,
    );
    if (!result) {
      throw new Error(`stims.agent driver not installed for ${preset.id}.`);
    }
    if (!result.applied) {
      throw new Error(
        `preset did not apply (active: ${result.activePresetId ?? 'none'}) for ${preset.id}.`,
      );
    }
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('canvas')].some((c) => c.width >= 400),
      undefined,
      { timeout: SWAP_TIMEOUT_MS },
    );

    let failure = 'unknown';
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const capture = await page.evaluate(
        ({ minFrames, maxFrames, beatPulse, plateauCheckpoints }) => {
          const step = window.__STIMS_AGENT_RENDER_FRAMES__;
          if (typeof step !== 'function') {
            return { error: 'render hook missing' };
          }
          // The stage canvas is the largest one — small canvases are
          // identicons and HUD widgets.
          const canvas = [...document.querySelectorAll('canvas')].sort(
            (a, b) => b.width * b.height - a.width * a.height,
          )[0];
          if (!canvas || canvas.width < 400) {
            return { error: 'stage canvas not available' };
          }
          // Read the GL drawing buffer directly instead of toDataURL on the
          // stage canvas: the composite pass leaves alpha at 0, which
          // toDataURL encodes as a fully transparent (black) PNG. Same JS
          // task as the render, so the buffer is still valid.
          const gl =
            (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ??
            (canvas.getContext('webgl') as WebGLRenderingContext | null);
          if (!gl) {
            return { error: 'stage canvas has no WebGL context' };
          }
          const w = gl.drawingBufferWidth;
          const h = gl.drawingBufferHeight;
          const px = new Uint8Array(w * h * 4);
          const full = document.createElement('canvas');
          full.width = w;
          full.height = h;
          const fullCtx = full.getContext('2d');
          const small = document.createElement('canvas');
          small.width = 96;
          small.height = 54;
          const smallCtx = small.getContext('2d');
          if (!fullCtx || !smallCtx) {
            return { error: '2d context unavailable' };
          }

          const snapshot = () => {
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
            const image = fullCtx.createImageData(w, h);
            // GL rows are bottom-up; ImageData is top-down. Opaque alpha —
            // the renderer's alpha channel is an internal scratch value.
            for (let y = 0; y < h; y++) {
              image.data.set(
                px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4),
                y * w * 4,
              );
            }
            for (let i = 3; i < image.data.length; i += 4) {
              image.data[i] = 255;
            }
            fullCtx.putImageData(image, 0, 0);
            smallCtx.drawImage(full, 0, 0, 96, 54);
            const d = smallCtx.getImageData(0, 0, 96, 54).data;
            let sum = 0;
            let sumSq = 0;
            let max = 0;
            let blown = 0;
            for (let i = 0; i < d.length; i += 4) {
              const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
              sum += l;
              sumSq += l * l;
              if (l > max) max = l;
              if (d[i] >= 250 && d[i + 1] >= 250 && d[i + 2] >= 250) blown += 1;
            }
            const mean = sum / (96 * 54);
            const std = Math.sqrt(Math.max(0, sumSq / (96 * 54) - mean * mean));
            return { mean, max, std, blown: blown / (96 * 54) };
          };

          // A good preview frame has visible structure and isn't blown out.
          // Feedback presets go black → structured → saturated white as sim
          // time accumulates, so keep sampling and hold the BEST frame.
          //
          // This used to stop at the first frame clearing `isGood`, whose bar
          // was mean >= 0.4 out of 255 — a nearly-black frame with a handful
          // of lit pixels ended the search on the spot, long before a feedback
          // preset had drawn anything. Measured over the shipped set that left
          // a median luminance of 17/255 with 27% of thumbnails effectively
          // black. Structure (std) is what actually makes a thumbnail
          // readable, so it drives the score, scaled down for frames that are
          // technically lit but almost empty, and zeroed at both failure ends.
          const acceptable = (s: { mean: number; max: number; std: number }) =>
            s.max >= 32 && s.mean >= 0.4 && s.mean <= 240 && s.std >= 2.5;
          // A clipped white region has enormous std, so an unpenalized score
          // ranks "black rectangle with a white blob burned into it" above the
          // structured frame a second earlier. Squaring the unclipped fraction
          // makes a frame that is half blown out worth a quarter of the same
          // structure drawn in tones the viewer can actually see.
          const score = (s: {
            mean: number;
            max: number;
            std: number;
            blown: number;
          }) => {
            if (s.max < 32 || s.mean > 240) return 0;
            return (
              s.std * Math.min(1, s.mean / 8) * (1 - Math.min(1, s.blown)) ** 2
            );
          };

          let rendered = 0;
          const pump = (n: number) => {
            const result = step({ frames: n, beatPulse });
            if (!result) return false;
            rendered += result.rendered;
            return true;
          };
          if (!pump(minFrames)) {
            return { error: 'render hook returned null (audio active?)' };
          }
          let best: {
            score: number;
            dataUrl: string;
            framesUsed: number;
          } | null = null;
          // Stop once the image has stopped getting better rather than at the
          // first passable frame — but only after one acceptable frame exists,
          // so a slow-blooming preset is never abandoned while still black.
          // Running the full budget for every preset would be correct and far
          // too slow across ~2,700 of them; a plateau is the cheap equivalent.
          let sinceImprovement = 0;
          for (;;) {
            const s = snapshot();
            const sc = score(s);
            if (!best || sc > best.score) {
              best = {
                score: sc,
                dataUrl: full.toDataURL('image/png'),
                framesUsed: rendered,
              };
              sinceImprovement = 0;
            } else {
              sinceImprovement += 1;
            }
            const settled =
              sinceImprovement >= plateauCheckpoints && best.score > 0;
            if (settled || rendered >= maxFrames) break;
            // Sample finely while saturation risk is highest, then coarsen.
            const stride = rendered < 60 ? 15 : rendered < 120 ? 30 : 60;
            if (!pump(stride)) {
              return { error: 'render hook returned null (audio active?)' };
            }
          }
          // `acceptable` stays the shared definition of a usable frame; the
          // Node side re-checks it authoritatively before writing.
          void acceptable;
          return {
            dataUrl: best.dataUrl,
            rendered,
            framesUsed: best.framesUsed,
          };
        },
        {
          minFrames: MIN_FRAMES,
          maxFrames: MAX_FRAMES,
          beatPulse: this.beatPulse,
          plateauCheckpoints: PLATEAU_CHECKPOINTS,
        },
      );

      if ('error' in capture) {
        throw new Error(capture.error);
      }

      const buffer = Buffer.from(
        capture.dataUrl.slice('data:image/png;base64,'.length),
        'base64',
      );
      const stats = await analyzeFrame(buffer);

      const badReason = badFrameReason(stats);
      if (badReason) {
        // No retry for black/flat: the page already checkpointed the full
        // frame budget and kept its best frame — more of the same signal
        // yields the same verdict, and retries dominate wall-clock on
        // dark-preset-heavy stretches. Duplicates DO retry (below): they
        // signal a swap race, which more sim time can resolve.
        failure = badReason;
        break;
      } else {
        const collidesWith = this.seenHashes.get(stats.hash);
        if (collidesWith && collidesWith !== preset.id) {
          // Identical pixels to another preset's capture — the canvas did
          // not actually advance to this preset.
          failure = `duplicate of ${collidesWith}`;
        } else {
          const outPath = join(OUTPUT_DIR, `${preset.id}.png`);
          // A re-sweep is not uniformly an upgrade: the capture search is a
          // plateau search over a moving image, so a preset that happened to
          // land on a good frame last time can land on a worse one now.
          // Under --keep-best a fresh capture has to beat what is already on
          // disk before it replaces it, which makes a corpus-wide re-run
          // monotonic instead of a coin flip per preset.
          if (this.keepBest && existsSync(outPath)) {
            const previous = await analyzeFrame(readFileSync(outPath));
            if (frameScore(stats) <= frameScore(previous)) {
              this.seenHashes.set(previous.hash, preset.id);
              this.tally.kept++;
              this.rendered++;
              return;
            }
          }
          this.seenHashes.set(stats.hash, preset.id);
          await writePreview(buffer, outPath);
          this.tally.improved++;
          this.rendered++;
          return;
        }
      }
    }

    this.rendered++;
    throw new Error(failure);
  }
}

async function worker(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  id: number,
  queue: PresetEntry[],
  counters: {
    success: number;
    fail: number;
    done: number;
    kept: number;
    improved: number;
  },
  failures: CaptureFailure[],
  total: number,
  devServer: string,
  seenHashes: Map<string, string>,
  catalogIds: string[],
  beatPulse: boolean,
  keepBest: boolean,
) {
  let ctx: BrowserContext | null = null;
  let session: RenderSession | null = null;

  while (queue.length > 0) {
    const preset = queue.shift();
    if (!preset) break;

    const t0 = Date.now();
    try {
      if (!ctx) {
        ctx = await browser.newContext({
          viewport: { ...CAPTURE_VIEWPORT },
          deviceScaleFactor: 1,
        });
        await ctx.addInitScript(() => {
          localStorage.setItem('stims:quality-preset', 'high');
          // Instant preset cuts — a blend crossfade would contaminate
          // captures with the previous preset. (The WebGL backend itself is
          // forced via ?renderer=webgl in the boot URL.)
          localStorage.setItem(
            'stims:milkdrop:ui',
            JSON.stringify({ transitionMode: 'cut', autoplay: false }),
          );
        });
      }
      if (session && session.rendered >= PAGE_RECYCLE_EVERY) {
        await session.close();
        session = null;
      }
      if (!session)
        session = new RenderSession(
          ctx,
          devServer,
          seenHashes,
          catalogIds,
          beatPulse,
          keepBest,
          counters,
        );

      await Promise.race([
        session.render(preset),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Per-preset timeout')),
            PER_PRESET_TIMEOUT_MS,
          ),
        ),
      ]);
      counters.success++;
      counters.done++;
      const elapsed = (Date.now() - t0) / 1000;
      const pct = ((counters.done / total) * 100).toFixed(0);
      console.log(`  [w${id}][${pct}%] ${preset.id} — ${elapsed.toFixed(1)}s`);
    } catch (err) {
      counters.fail++;
      counters.done++;
      const reason = err instanceof Error ? err.message : String(err);
      failures.push({ presetId: preset.id, reason });
      const elapsed = (Date.now() - t0) / 1000;
      const pct = ((counters.done / total) * 100).toFixed(0);
      console.log(
        `  [w${id}][${pct}%] FAIL ${preset.id} — ${elapsed.toFixed(1)}s: ${reason}`,
      );
      // A failure can mean a wedged page or GL context — rebuild both.
      if (session) {
        await session.close();
        session = null;
      }
      if (ctx) {
        await ctx.close().catch(() => {});
        ctx = null;
      }
    }
  }

  if (session) await session.close();
  if (ctx) await ctx.close().catch(() => {});
}

async function main() {
  const args = parseArgs();
  const presets = await getPresets(args);

  if (presets.length === 0) {
    console.error('No presets to render');
    process.exit(1);
  }

  console.log(`${presets.length} presets to render`);
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  const port = args.port ?? DEFAULT_PORT;
  const devServer = `http://localhost:${port}`;
  const server = await ensureDevServer(port);
  const concurrency = Math.min(args.workers ?? DEFAULT_WORKERS, presets.length);
  console.log(`Using ${concurrency} concurrent workers`);

  const browser = await chromium.launch({
    headless: args.headless,
    // Full Chromium (--headless=new), not the headless shell: the shell can
    // only rasterize through SwiftShader, while this renders on the real GPU
    // even headless.
    channel: 'chromium',
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      // Headed mode (--no-headless) only: persistent pages stack their
      // windows; without these flags macOS occlusion marks covered windows
      // hidden and preset swaps stall. Frame stepping itself doesn't rely
      // on RAF, so captures stay immune either way. Harmless when headless.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
  });
  const startTime = Date.now();
  const counters = { success: 0, fail: 0, done: 0, kept: 0, improved: 0 };
  const failures: CaptureFailure[] = [];
  const seenHashes = new Map<string, string>();

  const queue = [...presets];
  // Full catalog, not just the queue: the sacrificial boot preset must
  // differ from the target even when rendering a single id.
  const catalogIds = (await loadAllCatalogEntries()).map((p) => p.id);
  const workers = Array.from({ length: concurrency }, (_, i) =>
    worker(
      browser,
      i,
      queue,
      counters,
      failures,
      presets.length,
      devServer,
      seenHashes,
      catalogIds,
      args.beatPulse ?? false,
      args.keepBest ?? false,
    ),
  );
  await Promise.all(workers);

  const totalTime = (Date.now() - startTime) / 1000;
  console.log('');
  console.log('=== Done ===');
  console.log(`Total: ${(totalTime / 60).toFixed(1)}m`);
  console.log(`Success: ${counters.success}  Failed: ${counters.fail}`);
  if (args.keepBest)
    console.log(
      `Replaced: ${counters.improved}  Kept existing (not an improvement): ${counters.kept}`,
    );
  if (counters.success > 0)
    console.log(`Avg: ${(totalTime / counters.success).toFixed(1)}s/preset`);
  if (failures.length > 0) {
    const reportPath = join(OUTPUT_DIR, '..', 'preview-failures.json');
    // Trailing newline: this file is committed, and the repo's own formatter
    // check fails on it otherwise.
    writeFileSync(reportPath, `${JSON.stringify(failures, null, 2)}\n`);
    console.log(
      `${failures.length} presets failed — no file written; details in ${reportPath}`,
    );
  }

  await browser.close();
  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
