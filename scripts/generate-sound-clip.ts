/**
 * Records the README's with-sound clip through the app's own Record panel.
 * Requires ffmpeg and Playwright Chromium. Plays a preset to the built-in demo
 * loop, so the audio has no third-party rights attached, and refuses a clip
 * that has no audio stream or exceeds the WCAG 2.3.1 flash limit.
 *
 * bun scripts/generate-sound-clip.ts [--preset=shifter-curlique] [--seconds=20]
 *   [--no-headless]
 *
 * The raw recording stays in output/playwright/sound-clip; the H.264 + AAC MP4
 * goes to public/clips/{preset}-with-sound.mp4.
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { writeAnimatedWebp } from './animated-webp.ts';
import { hardwareAngleArgs } from './browser-launch.ts';
import { ensureDevServer } from './dev-server.ts';

const OUTPUT = 'output/playwright/sound-clip';
// Served from the site: GitHub will not play an MP4 this size from a repo link.
const ASSETS = 'public/clips';
const PORT = 5184;
const VIEWPORT = { width: 1280, height: 720 };
/** Frames for the flash check, matching the README clips' encode rate. */
const GATE_FPS = 30;
/** Lets the preset and the demo loop get going before the clip starts. */
const SETTLE_MS = 6000;
/** Starting to record restarts the feedback loop, so the first frames are dim. */
const TRIM_SECONDS = 3;
const WIDTH = 960;

function argValue(name: string, fallback: string) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function run(command: string[]) {
  const result = Bun.spawnSync(command, { stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString();
}

const preset = argValue('preset', 'shifter-curlique');
const seconds = Number(argValue('seconds', '20'));
if (!(seconds > 0)) throw new Error('--seconds must be a positive number.');
const output = join(ASSETS, `${preset}-with-sound.mp4`);
rmSync(OUTPUT, { recursive: true, force: true });
mkdirSync(OUTPUT, { recursive: true });
mkdirSync(ASSETS, { recursive: true });

const server = await ensureDevServer(PORT);
const browser = await chromium.launch({
  channel: 'chromium',
  headless: !process.argv.includes('--no-headless'),
  args: hardwareAngleArgs(),
});
try {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  await page.goto(
    `http://127.0.0.1:${PORT}/?agent=true&renderer=webgl&preset=${preset}`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.waitForFunction(() => window.__stims_agent !== undefined);
  await page.evaluate(() => window.__stims_agent?.run('audio-demo'));
  await page.waitForFunction(
    () => (window.__STIMS_AGENT_TELEMETRY__?.audioEnergy ?? 0) > 0,
  );
  await page.waitForTimeout(SETTLE_MS);
  await page.evaluate(() => window.__stims_agent?.run('open-record'));
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.waitForTimeout((seconds + TRIM_SECONDS) * 1000);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Stop and save video' }).click(),
  ]);
  const raw = join(OUTPUT, download.suggestedFilename());
  await download.saveAs(raw);

  const streams = run([
    'ffprobe',
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type',
    '-of',
    'csv=p=0',
    raw,
  ]);
  if (!streams.includes('audio'))
    throw new Error(`${raw} has no audio stream: ${streams.trim()}`);

  run([
    'ffmpeg',
    '-y',
    '-i',
    raw,
    '-ss',
    String(TRIM_SECONDS),
    '-vf',
    `scale=${WIDTH}:-2:flags=lanczos,fps=30`,
    // The demo loop plays well under full scale; bring it up to a normal level.
    '-af',
    'loudnorm=I=-16:TP=-1.5:LRA=11',
    '-c:v',
    'libx264',
    '-crf',
    '27',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    output,
  ]);

  const framesDir = join(OUTPUT, 'gate-frames');
  mkdirSync(framesDir, { recursive: true });
  run([
    'ffmpeg',
    '-y',
    '-i',
    output,
    '-vf',
    `fps=${GATE_FPS},scale=480:-1:flags=lanczos`,
    join(framesDir, '%04d.png'),
  ]);
  const frames = readdirSync(framesDir)
    .sort()
    .map((name) => join(framesDir, name));
  // Throws when the clip exceeds the limit; only the check matters here.
  await writeAnimatedWebp(frames, join(OUTPUT, 'gate.webp'), {
    fps: GATE_FPS,
  }).catch((error) => {
    rmSync(output, { force: true });
    throw error;
  });
  console.log(`Recorded ${output} from ${raw}`);
} finally {
  await browser.close();
  server.close();
}
