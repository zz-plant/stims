import { createAudioPipeline } from './audio';
import { createEffectState, nextMode, renderFrame } from './effects';
import {
  autoDetectTmux,
  Canvas,
  initTerminal,
  restoreTerminal,
  setRenderOptions,
} from './renderer';
import { readWav, readWavFromStdin, type WavFile } from './wav';
import { cleanupYoutube, downloadYoutube } from './youtube';

const HELP = `
stims-terminal — vibe-coding audio visualizer

usage: bun run terminal/index.ts [source] [flags]

source:
  <file.wav>        play a WAV file
  -                  read WAV from stdin (pipe)
  --yt <url>         play from YouTube (requires yt-dlp + ffmpeg)

flags:
  --loop             loop the file continuously
  --mode <n>         start mode (0:waveform 1:spectrum 2:orbit 3:bars 4:combo)
  --autocycle <s>    rotate modes every N seconds
  --tmux             optimise for tmux (no screen clear, compact width)
  --compact          narrow pane layout (60 cols, orbit+bars only)
  --minimal          hide particles, beat flash, and status bar
  --fps <n>          target FPS (default: 30, tmux: 15, compact: 12)
  -h, --help         show this help

controls:
  space              cycle visual mode
  q / esc / ^C       quit

examples:
  bun run terminal/index.ts song.wav
  yt-dlp -x --audio-format wav -o - URL | bun run terminal/index.ts -
  bun run terminal/index.ts --yt https://youtube.com/watch?v=xxx --autocycle 20
  bun run terminal/index.ts song.wav --tmux --compact --autocycle 30
`;

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  console.log(HELP);
  process.exit(0);
}

const ytIdx = process.argv.indexOf('--yt');
const loopMode = process.argv.includes('--loop');
const tmuxFlag = process.argv.includes('--tmux');
const compactMode = process.argv.includes('--compact');
const minimalMode = process.argv.includes('--minimal');

let startMode = 0;
const modeArg = process.argv.indexOf('--mode');
if (modeArg !== -1 && process.argv[modeArg + 1]) {
  startMode = parseInt(process.argv[modeArg + 1]!, 10) || 0;
}

let autocycleSecs = 0;
const cycleArg = process.argv.indexOf('--autocycle');
if (cycleArg !== -1 && process.argv[cycleArg + 1]) {
  autocycleSecs = Math.max(1, parseInt(process.argv[cycleArg + 1]!, 10) || 0);
}

let targetFps = 0;
const fpsArg = process.argv.indexOf('--fps');
if (fpsArg !== -1 && process.argv[fpsArg + 1]) {
  targetFps = Math.max(
    4,
    Math.min(60, parseInt(process.argv[fpsArg + 1]!, 10) || 0),
  );
}

autoDetectTmux();
if (
  tmuxFlag ||
  process.env.TERM?.includes('screen') ||
  process.env.TERM?.includes('tmux')
) {
  setRenderOptions({ tmux: true });
  if (!targetFps) targetFps = 15;
}
if (compactMode && !targetFps) targetFps = 12;
if (!targetFps) targetFps = 30;

let youtubeTemp: string | null = null;
let title = '';

async function loadSource(): Promise<{ path: string; title: string }> {
  if (ytIdx !== -1) {
    const url = process.argv[ytIdx + 1];
    if (!url) {
      console.error('Error: --yt requires a URL');
      process.exit(1);
    }
    try {
      const result = await downloadYoutube(url);
      youtubeTemp = result.wavPath;
      return { path: result.wavPath, title: result.title };
    } catch (err) {
      console.error(
        `  Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  }

  const filePath = process.argv[2];
  if (filePath === '-') {
    return { path: ':stdin:', title: 'stdin' };
  }
  if (!filePath) {
    console.error('Error: no WAV file or --yt URL specified.');
    console.log(HELP);
    process.exit(1);
  }
  return {
    path: filePath,
    title: filePath.replace(/^.*\//, '').replace(/\.wav$/i, ''),
  };
}

const source = await loadSource();
title = source.title;

process.stdout.write(`\n  ${title}\n`);

let wav: WavFile;
try {
  wav =
    source.path === ':stdin:' ? await readWavFromStdin() : readWav(source.path);
} catch (err) {
  console.error(`  Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

process.stdout.write(
  `  ${(wav.sampleRate / 1000).toFixed(1)}kHz ${wav.channels}ch ${wav.duration.toFixed(1)}s `,
);
if (minimalMode) process.stdout.write('| minimal');
if (compactMode) process.stdout.write(' | compact');
if (autocycleSecs > 0) process.stdout.write(` | autocycle ${autocycleSecs}s`);
process.stdout.write('\n');
process.stdout.write('  space=mode | q=quit\n\n');

let term = initTerminal();
let pipeline = createAudioPipeline(wav, Date.now());

const state = createEffectState({
  compact: compactMode,
  minimal: minimalMode,
  autocycleSecs,
});
state.modeIndex = Math.min(startMode, 4);

const canvas = new Canvas(term);

let running = true;
let timer: ReturnType<typeof setTimeout> | null = null;

function stop() {
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const isTTY = typeof process.stdin.setRawMode === 'function';
if (isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (key: string) => {
    if (key === '\x03' || key === '\x1b' || key === 'q') stop();
    if (key === ' ') nextMode(state);
  });
}

if (isTTY) {
  process.stdout.on('resize', () => {
    term = initTerminal();
    canvas.setSize(term);
  });
}

const frameMs = 1000 / targetFps;

function tick() {
  if (!running) return;

  const start = Date.now();
  const now = Date.now();

  let frame = pipeline.nextFrame(now);
  if (!frame) {
    if (loopMode) {
      wav = readWav(source.path === ':stdin:' ? source.path : source.path);
      pipeline = createAudioPipeline(wav, now);
      frame = pipeline.nextFrame(now);
    }
    if (!frame) {
      stop();
      return;
    }
  }

  renderFrame(canvas, state, frame);
  canvas.render();

  const elapsed = Date.now() - start;
  timer = setTimeout(tick, Math.max(1, frameMs - elapsed));
}

tick();

function cleanup() {
  if (isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch {}
    process.stdin.pause();
  }
  if (running) {
    restoreTerminal();
    process.stdout.write('\n');
  }
  if (youtubeTemp) cleanupYoutube(youtubeTemp);
}

process.on('beforeExit', () => {
  cleanup();
  process.exit(0);
});

const exitPromise = new Promise<void>((resolve) => {
  const check = setInterval(() => {
    if (!running) {
      clearInterval(check);
      resolve();
    }
  }, 50);
});

await exitPromise;
cleanup();
