import { createAudioPipeline } from './audio';
import { createEffectState, nextMode, renderFrame } from './effects';
import { detectListenSetup, streamAudioFrames } from './listen';
import { createNormalizer, normalizeFrame } from './normalize';
import {
  autoDetectTmux,
  Canvas,
  initTerminal,
  restoreTerminal,
  setRenderOptions,
} from './renderer';
import { broadcastFrame, startServer, stopServer } from './server';
import { getTheme, themeNames } from './themes';
import { createVibeState, onInputActivity } from './vibe';
import { readWav, readWavFromStdin, type WavFile } from './wav';
import { cleanupYoutube, downloadYoutube } from './youtube';

const HELP = `
stims-terminal — vibe-coding audio visualizer

usage: bun run terminal/index.ts [source] [flags]

source:
  <file.wav>         play a WAV file
  -                   read WAV from stdin (pipe)
  --yt <url>          play from YouTube (requires yt-dlp + ffmpeg)
  --listen            capture system audio (requires BlackHole on macOS)

flags:
  --loop              loop the file continuously
  --play              play audio through speakers (requires ffplay)
  --no-normalize      disable auto-gain (on by default)
  --no-vibe           disable time-of-day + idle-aware behavior (on by default)
  --no-autocycle      disable mode rotation (20s by default)
  --serve <port>      broadcast ANSI frames over HTTP on :port
  --mode <n>          lock to one mode (0:waveform 1:spectrum 2:orbit 3:bars 4:combo)
  --autocycle <s>     rotate modes every N seconds (default: 20s)
  --theme <name>      color theme (default: ocean): ${themeNames().join(' ')}
  --tmux              optimise for tmux (no screen clear, compact width)
  --compact           narrow pane layout (60 cols, orbit+bars only)
  --minimal           hide particles, beat flash, and status bar
  --fps <n>           target FPS (default: 20, tmux: 15, compact: 10)
  -h, --help          show this help

controls:
  space               cycle visual mode
  q / esc / ^C        quit
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
const listenMode = process.argv.includes('--listen');
const playAudio = process.argv.includes('--play');
const normalizeMode = !process.argv.includes('--no-normalize');
const vibeMode = !process.argv.includes('--no-vibe');

let servePort = 0;
const serveArg = process.argv.indexOf('--serve');
if (serveArg !== -1 && process.argv[serveArg + 1]) {
  servePort = parseInt(process.argv[serveArg + 1]!, 10) || 9393;
}

let startMode = 2;
let autocycleSecs = process.argv.includes('--no-autocycle') ? 0 : 20;

const modeArg = process.argv.indexOf('--mode');
if (modeArg !== -1 && process.argv[modeArg + 1]) {
  startMode = parseInt(process.argv[modeArg + 1]!, 10) || 0;
  if (!process.argv.includes('--autocycle')) autocycleSecs = 0;
}

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

let themeName = 'ocean';
const themeArg = process.argv.indexOf('--theme');
if (themeArg !== -1 && process.argv[themeArg + 1]) {
  themeName = process.argv[themeArg + 1]!;
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
if (compactMode && !targetFps) targetFps = 10;
if (!targetFps) targetFps = 20;

let youtubeTemp: string | null = null;
let title = '';
let playerProc: ReturnType<typeof Bun.spawn> | null = null;

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
  if (listenMode) return { path: ':listen:', title: 'System Audio' };
  const filePath = process.argv[2];
  if (filePath === '-') return { path: ':stdin:', title: 'stdin' };
  if (!filePath) {
    console.error('Error: no WAV file, --yt URL, or --listen specified.');
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

const isStreaming = source.path === ':listen:';

let wav: WavFile | null = null;
if (!isStreaming) {
  try {
    wav =
      source.path === ':stdin:'
        ? await readWavFromStdin()
        : readWav(source.path);
  } catch (err) {
    console.error(
      `  Error: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `  ${(wav.sampleRate / 1000).toFixed(1)}kHz ${wav.channels}ch ${wav.duration.toFixed(1)}s `,
  );
} else {
  const setup = detectListenSetup();
  if (setup.command.length === 0) {
    console.error(`\n${setup.hint}\n`);
    process.exit(1);
  }
  process.stdout.write(`  ${setup.hint}\n`);
  if (playAudio) console.log('  Note: --play has no effect with --listen');
}

if (playAudio && wav) {
  try {
    playerProc = Bun.spawn(
      ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet', source.path],
      { stdout: 'null', stderr: 'null' },
    );
  } catch {
    /* ffplay not found */
  }
}

const normalizer = normalizeMode ? createNormalizer() : null;
const vibe = vibeMode ? createVibeState() : null;

const theme = getTheme(themeName);
if (themeName) process.stdout.write(` | ${theme.name}`);
if (normalizeMode) process.stdout.write(' | normalize');
if (vibeMode) process.stdout.write(' | vibe');
if (servePort) process.stdout.write(` | :${servePort}`);
if (minimalMode) process.stdout.write(' | minimal');
if (compactMode) process.stdout.write(' | compact');
if (autocycleSecs > 0) process.stdout.write(` | autocycle ${autocycleSecs}s`);
process.stdout.write('\n');
process.stdout.write('  space=mode | q=quit\n\n');

let term = initTerminal();
const state = createEffectState({
  compact: compactMode,
  minimal: minimalMode,
  autocycleSecs,
  theme,
});
state.modeIndex = Math.min(startMode, 4);
const canvas = new Canvas(term);

if (servePort) {
  startServer(servePort, () =>
    process.stdout.write(`  Viewer connected :${servePort}\n`),
  );
}

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
    if (vibe) onInputActivity(vibe);
  });
}

if (isTTY) {
  process.stdout.on('resize', () => {
    term = initTerminal();
    canvas.setSize(term);
  });
}

const frameMs = 1000 / targetFps;

function applyVibe(frame: { time: number }) {
  if (!vibe) return;
  vibe.update(new Date());
  if (state.options.autocycleSecs > 0) {
    const rate = 1 + vibe.intensity * 2;
    state.modeTimer += rate / 30;
    const secs = Math.max(3, state.options.autocycleSecs + vibe.intensity * 15);
    if (state.modeTimer >= secs) state.modeTimer = 0;
  }
}

function writeAndBroadcast(ansi: string) {
  process.stdout.write(ansi);
  if (servePort) broadcastFrame(ansi);
}

if (isStreaming) {
  const setup = detectListenSetup();
  Bun.spawn(setup.command, { stdout: 'pipe', stderr: 'null' });

  const stream = streamAudioFrames(44100);
  const frameGen = stream[Symbol.asyncIterator]();

  async function streamTick() {
    if (!running) return;
    const start = Date.now();
    const { value: rawFrame, done } = await frameGen.next();
    if (done) {
      stop();
      return;
    }
    const frame = rawFrame as any;
    applyVibe(frame);
    if (normalizer) {
      normalizeFrame(normalizer, frame.rms, frameMs);
      frame.bands = {
        bass: frame.bands.bass * normalizer.gain,
        mid: frame.bands.mid * normalizer.gain,
        treble: frame.bands.treble * normalizer.gain,
      };
      frame.smoothedBands = {
        bass: frame.smoothedBands.bass * normalizer.gain,
        mid: frame.smoothedBands.mid * normalizer.gain,
        treble: frame.smoothedBands.treble * normalizer.gain,
      };
      state.normalizeGain = normalizer.gain;
    }
    if (vibe) state.vibeIntensity = vibe.intensity;
    renderFrame(canvas, state, frame);
    const ansi = canvas.render();
    writeAndBroadcast(ansi);
    const elapsed = Date.now() - start;
    timer = setTimeout(streamTick, Math.max(1, frameMs - elapsed));
  }
  streamTick();
} else {
  let pipeline = createAudioPipeline(wav!, Date.now());

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
    applyVibe(frame);
    if (normalizer) {
      normalizeFrame(normalizer, frame.rms, frameMs);
      frame.bands = {
        bass: frame.bands.bass * normalizer.gain,
        mid: frame.bands.mid * normalizer.gain,
        treble: frame.bands.treble * normalizer.gain,
      };
      frame.smoothedBands = {
        bass: frame.smoothedBands.bass * normalizer.gain,
        mid: frame.smoothedBands.mid * normalizer.gain,
        treble: frame.smoothedBands.treble * normalizer.gain,
      };
      for (let i = 0; i < frame.spectrum.length; i++)
        frame.spectrum[i] = (frame.spectrum[i] ?? 0) * normalizer.gain;
      for (let i = 0; i < frame.waveform.length; i++)
        frame.waveform[i] = (frame.waveform[i] ?? 0) * normalizer.gain;
      state.normalizeGain = normalizer.gain;
    }
    if (vibe) state.vibeIntensity = vibe.intensity;
    renderFrame(canvas, state, frame);
    const ansi = canvas.render();
    writeAndBroadcast(ansi);
    const elapsed = Date.now() - start;
    timer = setTimeout(tick, Math.max(1, frameMs - elapsed));
  }
  tick();
}

function cleanup() {
  if (isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch {}
    process.stdin.pause();
  }
  if (playerProc) {
    try {
      playerProc.kill();
    } catch {}
  }
  stopServer();
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
