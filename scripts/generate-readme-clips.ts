/**
 * Animated README clip generator — renders short looping GIFs of presets.
 *
 * Shares the capture approach used by generate-thumbnails.ts: boot the app
 * once in agent mode with no audio, hot-swap presets over the agent bridge,
 * and pump simulation frames synchronously through
 * window.__STIMS_AGENT_RENDER_FRAMES__ so captures are deterministic and
 * immune to RAF pauses. Frames are read straight off the GL drawing buffer
 * (toDataURL on the stage canvas encodes alpha=0 as transparent black), then
 * encoded to GIF by ffmpeg with a per-clip palette.
 *
 * --audio=demo swaps that for the bundled demo track: the live render loop
 * owns the pipeline (the step hook is disabled while audio is active) and
 * frames are sampled in wall-clock time instead. Beat-gated presets need it,
 * but feedback-heavy ones saturate to white under sustained energy, so lower
 * --settle when a clip blows out.
 *
 * Usage:
 *   bun run scripts/generate-readme-clips.ts --ids=geiss-casino,orb-radiation
 *   bun run scripts/generate-readme-clips.ts --ids=... --width=420 --fps=20
 *   bun run scripts/generate-readme-clips.ts --ids=... --seconds=4 --warmup=240
 *   bun run scripts/generate-readme-clips.ts --ids=... --audio=demo --settle=1500
 *   bun run scripts/generate-readme-clips.ts --ids=... --no-headless   # debug
 *
 * Requires: Playwright Chromium and ffmpeg on PATH.
 * Outputs: docs/assets/clips/{presetId}.gif
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ensureDevServer } from './dev-server.ts';

const OUTPUT_DIR = 'docs/assets/clips';
const TMP_ROOT = '.cache/readme-clips';
const DEFAULT_PORT = 5183;
const DEFAULT_WIDTH = 420;
const DEFAULT_FPS = 20;
const DEFAULT_SECONDS = 4;
/** Cap on sim frames burned before the first capture (synthetic mode). */
const DEFAULT_WARMUP = 180;
/**
 * Floor on warm-up frames. Right after a swap the framebuffer still holds
 * the previous preset, so probing before this many frames measures the
 * wrong preset.
 */
const MIN_WARMUP = 90;
/** Wall-clock settle before capturing under live audio. */
const DEFAULT_SETTLE_MS = 3500;
const BOOT_TIMEOUT_MS = 60000;
const CAPTURE_VIEWPORT = { width: 1280, height: 720 };
/** Engine sim rate; the stride between captures derives from this. */
const SIM_FPS = 60;

function parseArgs() {
  const args = {
    ids: [] as string[],
    width: DEFAULT_WIDTH,
    fps: DEFAULT_FPS,
    seconds: DEFAULT_SECONDS,
    warmup: DEFAULT_WARMUP,
    port: DEFAULT_PORT,
    headless: true,
    beatPulse: true,
    /**
     * 'synthetic' pumps the deterministic idle signal through the render
     * hook (fast, reproducible, but low-energy — beat-gated presets barely
     * move). 'demo' plays the bundled demo track and samples the live render
     * loop instead, which is what makes presets look the way they do in
     * normal use.
     */
    audio: 'synthetic' as 'synthetic' | 'demo',
    settleMs: DEFAULT_SETTLE_MS,
  };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--ids=')) args.ids = arg.slice(6).split(',');
    if (arg.startsWith('--width=')) args.width = parseInt(arg.slice(8), 10);
    if (arg.startsWith('--fps=')) args.fps = parseInt(arg.slice(6), 10);
    if (arg.startsWith('--seconds=')) args.seconds = Number(arg.slice(10));
    if (arg.startsWith('--warmup=')) args.warmup = parseInt(arg.slice(9), 10);
    if (arg.startsWith('--port=')) args.port = parseInt(arg.slice(7), 10);
    if (arg === '--no-headless') args.headless = false;
    if (arg === '--no-beat-pulse') args.beatPulse = false;
    if (arg === '--audio=demo') args.audio = 'demo';
    if (arg.startsWith('--settle=')) args.settleMs = parseInt(arg.slice(9), 10);
  }
  return args;
}

async function main() {
  const args = parseArgs();
  if (args.ids.length === 0) {
    console.error('Pass --ids=preset-a,preset-b');
    process.exit(1);
  }

  const catalog = await Bun.file('public/milkdrop-presets/catalog.json').json();
  const catalogIds: string[] = (catalog.presets ?? []).map(
    (p: { id: string }) => p.id,
  );
  const unknown = args.ids.filter((id) => !catalogIds.includes(id));
  if (unknown.length > 0) {
    console.error(`Unknown preset ids: ${unknown.join(', ')}`);
    process.exit(1);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const devServer = `http://localhost:${args.port}`;
  await ensureDevServer(args.port);
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: args.headless,
    args: [
      '--use-angle=metal',
      '--enable-gpu',
      // Demo audio starts from a postMessage, not a click.
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const ctx = await browser.newContext({ viewport: CAPTURE_VIEWPORT });
  const page = await ctx.newPage();

  const bootId =
    catalogIds.find((id) => id !== args.ids[0]) ?? (args.ids[0] as string);
  await page.goto(
    `${devServer}/?preset=${bootId}&agent=true&renderer=webgl&lockQualityStep=0`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.waitForFunction(
    () =>
      typeof window.__STIMS_AGENT_RENDER_FRAMES__ === 'function' &&
      typeof window.__STIMS_AGENT_BRIDGE__ === 'object',
    undefined,
    { timeout: BOOT_TIMEOUT_MS },
  );

  const frameCount = Math.max(2, Math.round(args.fps * args.seconds));
  const stride = Math.max(1, Math.round(SIM_FPS / args.fps));
  const liveAudio = args.audio === 'demo';

  if (liveAudio) {
    await page.evaluate(() => {
      window.postMessage({ type: 'toil:set_audio', source: 'demo' }, '*');
    });
    // The bundled track has to decode and the analyser has to see signal
    // before any preset reacts; telemetry publishes the measured energy.
    await page.waitForFunction(
      () => (window.__STIMS_AGENT_TELEMETRY__?.audioEnergy ?? 0) > 0,
      undefined,
      { timeout: BOOT_TIMEOUT_MS },
    );
    console.log('demo audio active');
  }

  for (const presetId of args.ids) {
    console.log(`▶ ${presetId}`);
    await page.goto(
      `${devServer}/?preset=${presetId}&agent=true&renderer=webgl&lockQualityStep=0`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.waitForFunction(
      () =>
        typeof window.__STIMS_AGENT_RENDER_FRAMES__ === 'function' &&
        [...document.querySelectorAll('canvas')].some((c) => c.width >= 400),
      undefined,
      { timeout: BOOT_TIMEOUT_MS },
    );

    const tmpDir = join(TMP_ROOT, presetId);
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });

    // One evaluate per frame keeps peak memory bounded: a 4s clip at 20fps
    // is 80 full-resolution PNG data URLs, which is far too much to hold in
    // one round trip.
    const setup = await page.evaluate(
      ({ warmup, minWarmup, beatPulse, liveAudio }) => {
        const step = window.__STIMS_AGENT_RENDER_FRAMES__;
        if (typeof step !== 'function') return { error: 'render hook missing' };
        const canvas = [...document.querySelectorAll('canvas')].sort(
          (a, b) => b.width * b.height - a.width * a.height,
        )[0];
        if (!canvas || canvas.width < 400) {
          return { error: 'stage canvas not available' };
        }
        const gl =
          (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ??
          (canvas.getContext('webgl') as WebGLRenderingContext | null);
        if (!gl) return { error: 'stage canvas has no WebGL context' };

        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;
        const scratch = document.createElement('canvas');
        scratch.width = w;
        scratch.height = h;
        const scratchCtx = scratch.getContext('2d');
        if (!scratchCtx) return { error: '2d context unavailable' };
        const px = new Uint8Array(w * h * 4);

        const win = window as unknown as {
          __clipCapture__?: (frames: number) => string;
        };
        // frames === 0 means "capture whatever the live render loop just
        // drew" — used by --audio=demo, where the audio loop owns the
        // pipeline and the synchronous step hook is disabled.
        win.__clipCapture__ = (frames: number) => {
          if (frames > 0) step({ frames, beatPulse });
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const image = scratchCtx.createImageData(w, h);
          // GL rows are bottom-up; ImageData is top-down. Alpha is an
          // internal scratch value, so force it opaque.
          for (let y = 0; y < h; y++) {
            image.data.set(
              px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4),
              y * w * 4,
            );
          }
          for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
          scratchCtx.putImageData(image, 0, 0);
          return scratch.toDataURL('image/png');
        };

        // Feedback presets go black → structured → saturated white as sim
        // time accumulates, so don't warm up a fixed number of frames:
        // advance until the frame first looks good, capped at `warmup`.
        // Thresholds mirror generate-thumbnails.ts.
        const probe = document.createElement('canvas');
        probe.width = 96;
        probe.height = 54;
        const probeCtx = probe.getContext('2d');
        if (!probeCtx) return { error: '2d probe context unavailable' };
        const measure = () => {
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const image = scratchCtx.createImageData(w, h);
          for (let y = 0; y < h; y++) {
            image.data.set(
              px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4),
              y * w * 4,
            );
          }
          for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
          scratchCtx.putImageData(image, 0, 0);
          probeCtx.drawImage(scratch, 0, 0, 96, 54);
          const d = probeCtx.getImageData(0, 0, 96, 54).data;
          let sum = 0;
          let sumSq = 0;
          let max = 0;
          for (let i = 0; i < d.length; i += 4) {
            const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            sum += l;
            sumSq += l * l;
            if (l > max) max = l;
          }
          const mean = sum / (96 * 54);
          return {
            mean,
            max,
            std: Math.sqrt(Math.max(0, sumSq / (96 * 54) - mean * mean)),
          };
        };

        // Under live audio the render loop owns the pipeline, so there is
        // nothing to pump here — the wall-clock settle in Node does the job.
        if (liveAudio) return { width: w, height: h, warmed: 0, ...measure() };

        // Always burn a floor of frames first: right after a swap the
        // framebuffer still holds the *previous* preset, which would
        // otherwise satisfy the "looks good" test immediately.
        let warmed = 0;
        step({ frames: minWarmup, beatPulse });
        warmed += minWarmup;
        let stats = measure();
        const good = (s: { mean: number; max: number; std: number }) =>
          s.max >= 32 && s.mean >= 0.4 && s.mean <= 200 && s.std >= 2.5;
        while (!good(stats) && warmed < warmup) {
          step({ frames: 15, beatPulse });
          warmed += 15;
          stats = measure();
        }
        return { width: w, height: h, warmed, ...stats };
      },
      {
        warmup: args.warmup,
        minWarmup: Math.min(args.warmup, MIN_WARMUP),
        beatPulse: args.beatPulse,
        liveAudio: args.audio === 'demo',
      },
    );
    if ('error' in setup && setup.error) {
      console.error(`  ✗ ${setup.error}`);
      continue;
    }
    if ('warmed' in setup) {
      console.log(
        `  warmup=${setup.warmed} mean=${setup.mean.toFixed(1)} std=${setup.std.toFixed(1)}`,
      );
    }

    // Live audio: let the preset settle in wall-clock time, then sample the
    // live render loop at the target frame interval.
    if (liveAudio) await page.waitForTimeout(args.settleMs);

    const frameInterval = 1000 / args.fps;
    for (let i = 0; i < frameCount; i++) {
      const startedAt = Date.now();
      const dataUrl = (await page.evaluate(
        (n) =>
          (
            window as unknown as { __clipCapture__: (f: number) => string }
          ).__clipCapture__(n),
        liveAudio ? 0 : stride,
      )) as string;
      if (liveAudio) {
        const remaining = frameInterval - (Date.now() - startedAt);
        if (remaining > 0) await page.waitForTimeout(remaining);
      }
      writeFileSync(
        join(tmpDir, `${String(i).padStart(4, '0')}.png`),
        Buffer.from(dataUrl.split(',')[1] ?? '', 'base64'),
      );
    }

    const outPath = join(OUTPUT_DIR, `${presetId}.gif`);
    const filters =
      `fps=${args.fps},scale=${args.width}:-1:flags=lanczos,` +
      `split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];` +
      `[b][p]paletteuse=dither=bayer:bayer_scale=3`;
    const proc = Bun.spawnSync([
      'ffmpeg',
      '-y',
      '-framerate',
      String(args.fps),
      '-i',
      join(tmpDir, '%04d.png'),
      '-vf',
      filters,
      '-loop',
      '0',
      outPath,
    ]);
    if (proc.exitCode !== 0) {
      console.error(`  ✗ ffmpeg failed:\n${proc.stderr.toString()}`);
      continue;
    }
    rmSync(tmpDir, { recursive: true, force: true });
    const size = Bun.file(outPath).size;
    console.log(`  ✓ ${outPath} (${(size / 1024).toFixed(0)} KB)`);
  }

  await ctx.close();
  await browser.close();
  process.exit(0);
}

await main();
