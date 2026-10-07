// The flash-guard site: a video checker and the live governor demo, both on
// the real library bundle built by scripts/build-site.ts.
import {
  classifyFlashRisk,
  createBrightnessFilterApplier,
  createFlashController,
  createFlashFrameCounter,
  createFlashSampler,
  describeFlashRisk,
  relativeLuminance,
} from './lib/flash-guard.js';

const $ = (id) => document.getElementById(id);

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = 'copied';
      setTimeout(() => {
        button.textContent = 'copy';
      }, 1200);
    } catch {
      button.textContent = 'select it';
    }
  });
}

// ---------------------------------------------------------------- checker

const SAMPLE_FPS = 30;
const SAMPLE_WIDTH = 320;
const riskClass = {
  high: 'bad',
  medium: 'warn',
  low: 'ok',
  none: 'ok',
  unknown: '',
};

function drawLuminanceChart(canvas, series) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  const style = getComputedStyle(document.documentElement);
  ctx.strokeStyle = style.getPropertyValue('--line').trim() || '#ccc';
  for (const v of [0.25, 0.5, 0.75]) {
    const y = height - 4 - v * (height - 8);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.strokeStyle = style.getPropertyValue('--accent').trim() || '#3b6ea5';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  series.forEach((v, i) => {
    const x = (i / Math.max(1, series.length - 1)) * width;
    const y = height - 4 - v * (height - 8);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function showResult(analysis, meanLuminance, label) {
  const risk = classifyFlashRisk(analysis);
  $('risk').textContent = risk;
  $('risk').className = `value ${riskClass[risk] ?? ''}`;
  $('peak').textContent = analysis.peakFlashesPerSecond;
  $('peak').className = `value ${analysis.exceedsThreshold ? 'bad' : 'ok'}`;
  $('redPeak').textContent = analysis.peakRedFlashesPerSecond;
  $('redPeak').className =
    `value ${analysis.exceedsRedThreshold ? 'bad' : 'ok'}`;
  $('total').textContent = analysis.totalFlashes;
  $('meanLum').textContent = analysis.meanLuminance.toFixed(3);
  $('frames').textContent = analysis.frameCount;
  drawLuminanceChart($('lumChart'), meanLuminance);
  const seconds = (analysis.frameCount / SAMPLE_FPS).toFixed(1);
  $('verdict').textContent =
    `${label}: ${describeFlashRisk(risk)} over ${seconds} s. ${
      analysis.exceedsThreshold || analysis.exceedsRedThreshold
        ? 'This exceeds the WCAG 2.3.1 general or red flash threshold and would need review.'
        : 'This stays under the WCAG 2.3.1 thresholds for the sampled span.'
    }`;
  $('result').hidden = false;
  window.__flashGuardSite.lastAnalysis = analysis;
}

/**
 * Only the latest analysis may drive the shared <video> and scratch canvas.
 * Each run takes a generation number; after every await it checks it is
 * still current and stops if a newer run has started. Listeners are added
 * per wait with `once`, so a superseded run's promise still settles instead
 * of hanging on a handler the newer run replaced.
 */
let analysisGeneration = 0;

function waitForEvent(target, resolveOn, rejectOn, error) {
  return new Promise((resolve, reject) => {
    const onResolve = () => {
      target.removeEventListener(rejectOn, onReject);
      resolve();
    };
    const onReject = () => {
      target.removeEventListener(resolveOn, onResolve);
      reject(error());
    };
    target.addEventListener(resolveOn, onResolve, { once: true });
    target.addEventListener(rejectOn, onReject, { once: true });
  });
}

function setCheckerBusy(busy) {
  $('file').disabled = busy;
  $('synthetic').disabled = busy;
}

async function analyseVideo(file) {
  const generation = ++analysisGeneration;
  const current = () => generation === analysisGeneration;
  const video = $('video');
  const scratch = $('scratch');
  const status = $('status');
  const progress = $('progress');
  const maxSeconds = Number($('seconds').value);
  $('result').hidden = true;
  status.textContent = `Decoding ${file.name}…`;
  progress.hidden = false;
  progress.value = 0;
  setCheckerBusy(true);

  const url = URL.createObjectURL(file);
  try {
    video.src = url;
    await waitForEvent(
      video,
      'loadedmetadata',
      'error',
      () => new Error('the browser could not decode this file'),
    );
    if (!current()) return;
    const width = SAMPLE_WIDTH;
    const height = Math.max(
      1,
      Math.round((video.videoHeight / video.videoWidth) * width),
    );
    scratch.width = width;
    scratch.height = height;
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    const counter = createFlashFrameCounter({
      width,
      height,
      deltaMs: 1000 / SAMPLE_FPS,
      stride: 1,
    });
    const span = Math.min(video.duration, maxSeconds);
    const frames = Math.floor(span * SAMPLE_FPS);
    const meanLuminance = [];
    for (let f = 0; f < frames; f += 1) {
      const seeked = waitForEvent(
        video,
        'seeked',
        'error',
        () => new Error('the browser stopped decoding this file'),
      );
      video.currentTime = f / SAMPLE_FPS;
      await seeked;
      if (!current()) return;
      ctx.drawImage(video, 0, 0, width, height);
      counter.push(ctx.getImageData(0, 0, width, height).data);
      meanLuminance.push(counter.input().frameMeanLuminance[f]);
      if (f % 10 === 0) {
        progress.value = f / frames;
        status.textContent = `Analysing ${file.name}: ${(f / SAMPLE_FPS).toFixed(1)} of ${span.toFixed(1)} s`;
        await new Promise((r) => requestAnimationFrame(r));
        if (!current()) return;
      }
    }
    progress.hidden = true;
    status.textContent = `${file.name}, ${video.videoWidth}x${video.videoHeight}, sampled at ${width}x${height}.`;
    showResult(counter.analyze(), meanLuminance, file.name);
  } catch (error) {
    if (!current()) return;
    progress.hidden = true;
    status.textContent = `Could not analyse: ${error.message}`;
  } finally {
    URL.revokeObjectURL(url);
    if (current()) setCheckerBusy(false);
  }
}

/** Two seconds of calm drifting gradient, then two seconds of a quarter-screen strobe. */
function syntheticStrobe() {
  const width = SAMPLE_WIDTH;
  const height = 180;
  const meanLuminance = [];
  const counter = createFlashFrameCounter({
    width,
    height,
    deltaMs: 1000 / SAMPLE_FPS,
    stride: 1,
  });
  const total = 4 * SAMPLE_FPS;
  for (let f = 0; f < total; f += 1) {
    const px = new Uint8Array(width * height * 4);
    const t = f / SAMPLE_FPS;
    const strobe = t >= 2 && Math.floor((t - 2) * 8) % 2 === 1; // 4 Hz square wave
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const o = (y * width + x) * 4;
        const drift =
          60 +
          50 * Math.sin((x / width) * 6 + t * 1.5) +
          30 * Math.cos((y / height) * 4 - t);
        let r = drift * 0.6;
        let g = drift * 0.7;
        let b = drift;
        if (strobe && x < width / 2 && y < height / 2) {
          r = g = b = 250;
        }
        px[o] = r;
        px[o + 1] = g;
        px[o + 2] = b;
        px[o + 3] = 255;
      }
    }
    counter.push(px);
    meanLuminance.push(counter.input().frameMeanLuminance[f]);
  }
  return { analysis: counter.analyze(), meanLuminance };
}

$('seconds').addEventListener('input', () => {
  $('secondsOut').textContent = $('seconds').value;
});
$('file').addEventListener('change', () => {
  const file = $('file').files?.[0];
  if (file) analyseVideo(file);
});
$('synthetic').addEventListener('click', () => {
  $('status').textContent =
    'Synthetic strobe: 2 s of calm drift, then a quarter-screen 4 Hz strobe for 2 s, 320x180 at 30 fps.';
  const { analysis, meanLuminance } = syntheticStrobe();
  showResult(analysis, meanLuminance, 'Synthetic strobe');
});

// ------------------------------------------------------------- governor

const stage = $('stage');
const ctx = stage.getContext('2d');
const trace = $('trace');
const tctx = trace.getContext('2d');
const hz = $('hz');
const contrast = $('contrast');
const governed = $('governed');
const area = $('area');
hz.oninput = () => {
  $('hzOut').textContent = hz.value;
};
contrast.oninput = () => {
  $('contrastOut').textContent = Number(contrast.value).toFixed(2);
};

const sampler = createFlashSampler();
const applyFilter = createBrightnessFilterApplier(stage);
let appliedScale = 1;
const controller = createFlashController({
  canvas: stage,
  sampler,
  applyLuminanceScale: (scale) => {
    appliedScale = scale;
    applyFilter(scale);
  },
  isEnabled: () => governed.checked,
  subscribeToFrames: () => () => {},
});
controller.start();

const history = { drawn: [], seen: [] };
const MAX = trace.width;

function drawTrace() {
  tctx.clearRect(0, 0, trace.width, trace.height);
  const plot = (series, color, width) => {
    tctx.strokeStyle = color;
    tctx.lineWidth = width;
    tctx.beginPath();
    series.forEach((v, i) => {
      const y = trace.height - 2 - v * (trace.height - 4);
      if (i === 0) tctx.moveTo(i, y);
      else tctx.lineTo(i, y);
    });
    tctx.stroke();
  };
  plot(history.drawn, '#c9a227', 1);
  plot(history.seen, '#3b6ea5', 2);
}

/** sRGB byte whose relative luminance is `level`. */
function greyForLuminance(level) {
  const srgb =
    level <= 0.0031308 ? level * 12.92 : 1.055 * level ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, srgb)) * 255);
}

const start = performance.now();
let frames = 0;
function frame(now) {
  const t = (now - start) / 1000;
  const rate = Number(hz.value);
  const on = rate > 0 && Math.floor(t * rate * 2) % 2 === 1;
  const c = Number(contrast.value);
  const low = 0.02;
  const high = low + c * (0.98 - low);
  const level = on ? high : low;
  const byte = greyForLuminance(level);
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, stage.width, stage.height);
  const frac = Number(area.value);
  ctx.fillStyle = `rgb(${byte},${byte},${byte})`;
  ctx.fillRect(0, 0, stage.width * frac, stage.height * frac);

  // Sample inside the same task as the draw.
  controller.tick(now);
  frames += 1;
  const state = controller.getState();
  $('flashes').textContent = state.flashesInWindow;
  $('hold').textContent = state.hold.toFixed(3);
  $('scale').textContent = appliedScale.toFixed(3);
  $('engaged').textContent = state.engaged ? 'yes' : 'no';
  $('sampler').textContent = sampler.offThread
    ? 'off-thread worker'
    : 'main thread';

  const drawn = level * frac * frac + low * (1 - frac * frac);
  history.drawn.push(drawn);
  history.seen.push(drawn * appliedScale);
  if (history.drawn.length > MAX) {
    history.drawn.shift();
    history.seen.shift();
  }
  drawTrace();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__flashGuardSite = {
  controller,
  sampler,
  lastAnalysis: null,
  get appliedScale() {
    return appliedScale;
  },
  get frames() {
    return frames;
  },
  relativeLuminance,
};
