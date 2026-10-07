// Page script for the audio-reactive site. Two demos share the same library
// build the package ships (`./lib/audio-reactive.js`, bundled from
// dist/index.js by scripts/build-site.ts):
//
//  - the offline demo runs the README's "Offline, no browser" example on
//    load, with no audio permission, and draws its energy timeline;
//  - the live demo loads the real AudioWorkletProcessor (`./lib/worklet.js`)
//    into an AudioContext and renders every field of the packets it posts.
//
// No build step for this file and no dependencies beyond the bundles.

import {
  analyseBlockBytes,
  buildHannWindow,
  buildTwiddleTable,
  createAudioReactivityInterpolator,
  createBeatTracker,
  createHarmonicPercussiveAnalyser,
  extractSpectralFeatures,
  getFrequencyBandLevels,
  getWeightedEnergy,
} from './lib/audio-reactive.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

function cssVar(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/** Theme colours read from styles.css so the canvases follow light/dark. */
function palette() {
  return {
    fg: cssVar('--fg'),
    muted: cssVar('--muted'),
    line: cssVar('--line'),
    accent: cssVar('--accent'),
    accent2: cssVar('--accent-2'),
    card: cssVar('--card'),
    ok: cssVar('--ok'),
  };
}

/** Sizes a canvas's backing store to its CSS box at device resolution. */
function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: canvas.clientWidth, height: canvas.clientHeight };
}

function setMeter(id, value) {
  const el = $(id);
  const v = Math.max(0, Math.min(1, value || 0));
  el.style.setProperty('--level', v.toFixed(4));
}

const fmt = {
  f2: (v) => (Number.isFinite(v) ? v.toFixed(2) : '–'),
  f3: (v) => (Number.isFinite(v) ? v.toFixed(3) : '–'),
  hz: (v) => (Number.isFinite(v) ? `${Math.round(v)} Hz` : '–'),
  int: (v) => (Number.isFinite(v) ? String(Math.round(v)) : '–'),
};

// ---------------------------------------------------------------------------
// Offline demo: the README example, run on load
// ---------------------------------------------------------------------------

function runOfflineDemo() {
  const sampleRate = 44100;
  const fftSize = 1024;
  const seconds = 2;

  // 440 Hz sine at -20 dBFS plus a 10 ms click every 500 ms.
  const samples = new Float32Array(sampleRate * seconds);
  for (let i = 0; i < samples.length; i += 1) {
    const t = i / sampleRate;
    samples[i] = 0.1 * Math.sin(2 * Math.PI * 440 * t);
    if (t % 0.5 < 0.01) samples[i] += 0.6 * (Math.random() * 2 - 1);
  }

  const window = buildHannWindow(fftSize);
  const twiddles = buildTwiddleTable(fftSize);
  const scratch = {
    real: new Float32Array(fftSize),
    imag: new Float32Array(fftSize),
  };
  const spectrum = new Uint8Array(fftSize / 2);
  const hpss = createHarmonicPercussiveAnalyser();
  const beats = createBeatTracker();

  let beatCount = 0;
  const blockMs = (fftSize / sampleRate) * 1000;
  const timeline = []; // { timeMs, energy, isBeat, ratio }
  const lines = [];
  for (let start = 0; start + fftSize <= samples.length; start += fftSize) {
    const block = samples.subarray(start, start + fftSize);
    analyseBlockBytes(block, window, twiddles, spectrum, scratch);

    const bands = getFrequencyBandLevels(spectrum, sampleRate);
    const energy = getWeightedEnergy(bands);
    const hp = hpss.analyse(spectrum, sampleRate);
    const timeMs = (start / sampleRate) * 1000;
    const beat = beats.update(
      { bands, weightedEnergy: energy, deltaMs: blockMs },
      timeMs,
    );
    if (beat.isBeat) beatCount += 1;
    timeline.push({
      timeMs,
      energy,
      isBeat: beat.isBeat,
      ratio: hp.percussiveRatio,
    });

    const frame = start / fftSize;
    if (frame === 20 || frame === 21 || frame === 22) {
      const features = extractSpectralFeatures(
        block,
        spectrum,
        sampleRate,
        fftSize,
      );
      lines.push(
        [
          `t=${(timeMs / 1000).toFixed(3)}s`,
          `bass=${bands.bass.toFixed(3)} mid=${bands.mid.toFixed(3)} treble=${bands.treble.toFixed(3)}`,
          `energy=${energy.toFixed(3)}`,
          `centroid=${features.spectralCentroid.toFixed(0)}Hz flatness=${features.spectralFlatness.toFixed(3)}`,
          `harmonic=${hp.harmonic.toFixed(3)} percussive=${hp.percussive.toFixed(3)} ratio=${hp.percussiveRatio.toFixed(2)}`,
          `beat=${beat.isBeat} intensity=${beat.beatIntensity.toFixed(2)}`,
        ].join(' '),
      );
    }
  }
  const summary = `beats detected in ${seconds}s: ${beatCount} (clicks placed: ${seconds * 2})`;
  $('offline-frames').textContent = lines.join('\n');
  $('offline-summary').textContent = summary;
  $('offline-summary').dataset.beats = String(beatCount);

  const canvas = $('offline-chart');
  const draw = () => {
    const { ctx, width, height } = fitCanvas(canvas);
    const c = palette();
    const pad = { left: 36, right: 12, top: 10, bottom: 22 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    ctx.clearRect(0, 0, width, height);

    // Recessive grid: 0, 0.5, 1 on the energy axis; a tick each 0.5 s.
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1;
    ctx.fillStyle = c.muted;
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of [0, 0.5, 1]) {
      const y = pad.top + plotH * (1 - v);
      ctx.beginPath();
      ctx.moveTo(pad.left, y + 0.5);
      ctx.lineTo(width - pad.right, y + 0.5);
      ctx.stroke();
      ctx.fillText(v.toFixed(1), pad.left - 6, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let s = 0; s <= seconds; s += 0.5) {
      const x = pad.left + (s / seconds) * plotW;
      ctx.fillText(`${s.toFixed(1)}s`, x, height - pad.bottom + 6);
    }

    // Energy as a 2px line.
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    timeline.forEach((p, i) => {
      const x = pad.left + (p.timeMs / (seconds * 1000)) * plotW;
      const y = pad.top + plotH * (1 - Math.min(1, p.energy));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Detected beats as markers on the curve, in the second accent.
    ctx.fillStyle = c.accent2;
    ctx.strokeStyle = c.card;
    ctx.lineWidth = 2;
    for (const p of timeline) {
      if (!p.isBeat) continue;
      const x = pad.left + (p.timeMs / (seconds * 1000)) * plotW;
      const y = pad.top + plotH * (1 - Math.min(1, p.energy));
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  };
  draw();
  new ResizeObserver(draw).observe(canvas);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);
  return { beatCount, summary };
}

// ---------------------------------------------------------------------------
// Live demo: the worklet in an AudioContext
// ---------------------------------------------------------------------------

const live = {
  context: null,
  node: null,
  source: null, // { stop(): void }
  raf: 0,
  packets: 0,
  beats: 0,
  startedAt: 0,
  latest: null, // last packet, with buffers copied out
  fftSize: 1024,
  spectrum: new Uint8Array(512),
  waveform: new Uint8Array(1024),
  interpolator: createAudioReactivityInterpolator(),
  rawTrace: new Float32Array(240),
  smoothTrace: new Float32Array(240),
  traceIndex: 0,
  beatFlash: 0,
};

// Exposed for headless probes and curious readers; read-only snapshot.
window.__audioReactiveDemo = live;

const supportsWorklet =
  typeof window.AudioContext === 'function' &&
  typeof window.AudioWorkletNode === 'function' &&
  'audioWorklet' in AudioContext.prototype;

function setStatus(text, kind) {
  const el = $('demo-status');
  el.textContent = text;
  el.className = `badge${kind ? ` ${kind}` : ''}`;
}

/**
 * Built-in test signal: a sustained three-note chord plus a stepping melody
 * (harmonic content), a kick every 500 ms and a noise hat every 250 ms
 * (percussive content), scheduled a little ahead of the clock.
 */
function createTestSignal(context, destination) {
  const master = context.createGain();
  master.gain.value = 0.9;
  master.connect(destination);

  // Chord: three detuned sawtooth-free sines through a gentle low-pass.
  const chordGain = context.createGain();
  chordGain.gain.value = 0.07;
  chordGain.connect(master);
  const chord = [220, 277.18, 329.63].map((frequency) => {
    const osc = context.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = frequency;
    osc.connect(chordGain);
    osc.start();
    return osc;
  });

  // Melody: one oscillator stepping through a pentatonic sequence.
  const melodyGain = context.createGain();
  melodyGain.gain.value = 0.12;
  melodyGain.connect(master);
  const melody = context.createOscillator();
  melody.type = 'square';
  melody.frequency.value = 440;
  melody.connect(melodyGain);
  melody.start();
  const notes = [440, 523.25, 587.33, 659.25, 783.99, 659.25, 587.33, 523.25];

  // One second of white noise, looped; the hat gain opens it briefly.
  const noiseBuffer = context.createBuffer(
    1,
    context.sampleRate,
    context.sampleRate,
  );
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  const noise = context.createBufferSource();
  noise.buffer = noiseBuffer;
  noise.loop = true;
  const hatFilter = context.createBiquadFilter();
  hatFilter.type = 'highpass';
  hatFilter.frequency.value = 5000;
  const hatGain = context.createGain();
  hatGain.gain.value = 0;
  noise.connect(hatFilter).connect(hatGain).connect(master);
  noise.start();

  const stopped = { current: false };
  const kicks = [];
  let nextStep = context.currentTime + 0.05;
  let step = 0;

  function scheduleKick(at) {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
    gain.gain.setValueAtTime(0.9, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + 0.25);
    kicks.push(osc);
    if (kicks.length > 8) kicks.shift();
  }

  function schedule() {
    if (stopped.current) return;
    while (nextStep < context.currentTime + 0.3) {
      const at = nextStep;
      // 16th-note grid at 120 BPM: 125 ms per step.
      if (step % 4 === 0) scheduleKick(at);
      if (step % 2 === 0) {
        hatGain.gain.setValueAtTime(0.35, at);
        hatGain.gain.exponentialRampToValueAtTime(0.001, at + 0.06);
      }
      if (step % 2 === 0) {
        melody.frequency.setValueAtTime(notes[(step / 2) % notes.length], at);
      }
      // A slow swell on the chord so the harmonic level moves too.
      chordGain.gain.setValueAtTime(0.05 + 0.04 * Math.sin(step / 6), at);
      nextStep += 0.125;
      step += 1;
    }
  }
  schedule();
  const timer = setInterval(schedule, 100);

  return {
    stop() {
      stopped.current = true;
      clearInterval(timer);
      for (const osc of [...chord, melody, ...kicks]) {
        try {
          osc.stop();
        } catch {
          // Already stopped.
        }
      }
      noise.stop();
      master.disconnect();
    },
  };
}

async function createMicrophoneSource(context, destination) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  const source = context.createMediaStreamSource(stream);
  // The worklet's output is silence, so routing through it to the
  // destination cannot feed back.
  source.connect(destination);
  return {
    stop() {
      source.disconnect();
      for (const track of stream.getTracks()) track.stop();
    },
  };
}

function onPacket(event) {
  const packet = event.data;
  if (!packet || !(packet.frequencyData instanceof ArrayBuffer)) return;
  const frequencyData = new Uint8Array(packet.frequencyData);
  const waveformData = new Uint8Array(packet.waveformData);
  const timeDomainData = new Float32Array(packet.timeDomainData);

  live.packets += 1;
  if (packet.beatDetection?.isBeat) {
    live.beats += 1;
    live.beatFlash = 1;
  }
  // Keep the bytes for the render loop, then hand the buffers straight back
  // so the processor's pool stays warm and it allocates nothing per packet.
  if (live.spectrum.length !== frequencyData.length)
    live.spectrum = new Uint8Array(frequencyData.length);
  if (live.waveform.length !== waveformData.length)
    live.waveform = new Uint8Array(waveformData.length);
  live.spectrum.set(frequencyData);
  live.waveform.set(waveformData);
  live.latest = packet;
  live.interpolator.pushSample(
    { ...packet.energy, rms: packet.rms },
    performance.now(),
  );

  live.node.port.postMessage(
    {
      type: 'recycle-buffers',
      freq: [frequencyData.buffer],
      wave: [waveformData.buffer],
      timeDomain: [timeDomainData.buffer],
    },
    [frequencyData.buffer, waveformData.buffer, timeDomainData.buffer],
  );
}

function drawSpectrum() {
  const { ctx, width, height } = fitCanvas($('spectrum'));
  const c = palette();
  ctx.clearRect(0, 0, width, height);
  const bins = live.spectrum;
  const sampleRate = live.context?.sampleRate ?? 44100;
  const nyquist = sampleRate / 2;
  // Log-frequency x axis from 30 Hz to Nyquist, so bass is not two pixels wide.
  const minHz = 30;
  const xOf = (hz) =>
    (Math.log(hz / minHz) / Math.log(nyquist / minHz)) * width;

  ctx.strokeStyle = c.line;
  ctx.lineWidth = 1;
  ctx.fillStyle = c.muted;
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const hz of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    if (hz >= nyquist) continue;
    const x = Math.round(xOf(hz)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height - 14);
    ctx.stroke();
    ctx.fillText(hz >= 1000 ? `${hz / 1000}k` : String(hz), x, height - 2);
  }

  ctx.fillStyle = c.accent;
  const plotH = height - 16;
  let prevX = 0;
  for (let i = 1; i < bins.length; i += 1) {
    const hz = (i * nyquist) / bins.length;
    if (hz < minHz) continue;
    const x = xOf(hz);
    const w = Math.max(1, x - prevX - 1);
    const h = (bins[i] / 255) * plotH;
    ctx.fillRect(prevX, plotH - h, w, h);
    prevX = x;
  }
}

function drawWaveform() {
  const { ctx, width, height } = fitCanvas($('waveform'));
  const c = palette();
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = c.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, Math.round(height / 2) + 0.5);
  ctx.lineTo(width, Math.round(height / 2) + 0.5);
  ctx.stroke();
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const wave = live.waveform;
  for (let i = 0; i < wave.length; i += 1) {
    const x = (i / (wave.length - 1)) * width;
    const y = height - (wave[i] / 255) * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawTrace(canvas, trace, index, colour) {
  const { ctx, width, height } = fitCanvas(canvas);
  const c = palette();
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = c.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height - 0.5);
  ctx.lineTo(width, height - 0.5);
  ctx.stroke();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const n = trace.length;
  for (let i = 0; i < n; i += 1) {
    const v = trace[(index + i) % n];
    const x = (i / (n - 1)) * width;
    const y = height - 2 - Math.min(1, v) * (height - 4);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function renderFrame() {
  live.raf = requestAnimationFrame(renderFrame);
  const p = live.latest;
  const now = performance.now();
  const elapsed = (now - live.startedAt) / 1000;
  $('packets').textContent = String(live.packets);
  $('packet-rate').textContent =
    elapsed > 0.5 ? `${(live.packets / elapsed).toFixed(1)} /s` : '–';

  if (!p) return;
  setMeter('meter-bass', p.energy.bass);
  setMeter('meter-mid', p.energy.mid);
  setMeter('meter-treble', p.energy.treble);
  $('val-bass').textContent = fmt.f3(p.energy.bass);
  $('val-mid').textContent = fmt.f3(p.energy.mid);
  $('val-treble').textContent = fmt.f3(p.energy.treble);
  $('avg-bass').textContent = fmt.f3(p.energyAverages.bass);
  $('avg-mid').textContent = fmt.f3(p.energyAverages.mid);
  $('avg-treble').textContent = fmt.f3(p.energyAverages.treble);

  const beat = p.beatDetection;
  live.beatFlash *= 0.9;
  const dot = $('beat-dot');
  dot.style.setProperty(
    '--intensity',
    Math.max(beat.beatIntensity, live.beatFlash).toFixed(3),
  );
  $('beat-count').textContent = String(live.beats);
  $('beat-intensity').textContent = fmt.f2(beat.beatIntensity);
  $('beat-bass').classList.toggle('on', beat.bassBeatIntensity > 0.3);
  $('beat-mid').classList.toggle('on', beat.midBeatIntensity > 0.3);
  $('beat-treble').classList.toggle('on', beat.trebleBeatIntensity > 0.3);
  $('transients').textContent =
    `subBassEnv ${fmt.f2(p.transientMetrics.subBassEnv)} · kickTransient ${fmt.f2(p.transientMetrics.kickTransient)} · ` +
    `vocalMidEnv ${fmt.f2(p.transientMetrics.vocalMidEnv)} · snareSnap ${fmt.f2(p.transientMetrics.snareSnap)}`;

  const hp = p.harmonicPercussive;
  if (hp) {
    setMeter('meter-harmonic', hp.harmonic);
    setMeter('meter-percussive', hp.percussive);
    $('val-harmonic').textContent = fmt.f3(hp.harmonic);
    $('val-percussive').textContent = fmt.f3(hp.percussive);
    $('val-ratio').textContent = fmt.f2(hp.percussiveRatio);
    $('ratio-marker').style.setProperty(
      '--ratio',
      hp.percussiveRatio.toFixed(3),
    );
    $('hp-split').textContent =
      `low ${fmt.f2(hp.percussiveLow)} · mid ${fmt.f2(hp.percussiveMid)} · high ${fmt.f2(hp.percussiveHigh)}`;
  }

  $('val-centroid').textContent = fmt.hz(p.spectralCentroid);
  $('val-flatness').textContent = fmt.f3(p.spectralFlatness);
  $('val-rolloff').textContent = fmt.hz(p.spectralRolloff);
  $('val-flux').textContent = fmt.f3(p.spectralFlux);
  $('val-crest').textContent = fmt.f2(p.spectralCrest);
  $('val-rms').textContent = fmt.f3(p.rms);
  $('val-zcr').textContent = fmt.f3(p.zeroCrossingRate);

  drawSpectrum();
  drawWaveform();

  // Interpolator comparison: raw = the last packet's bass, smooth = the
  // Hermite curve sampled at this frame's time.
  const smooth = live.interpolator.sample(now);
  const n = live.rawTrace.length;
  live.rawTrace[live.traceIndex] = p.energy.bass;
  live.smoothTrace[live.traceIndex] = smooth.bass;
  live.traceIndex = (live.traceIndex + 1) % n;
  setMeter('meter-raw', p.energy.bass);
  setMeter('meter-smooth', smooth.bass);
  $('val-raw').textContent = fmt.f3(p.energy.bass);
  $('val-smooth').textContent = fmt.f3(smooth.bass);
  const c = palette();
  drawTrace($('trace-raw'), live.rawTrace, live.traceIndex, c.muted);
  drawTrace($('trace-smooth'), live.smoothTrace, live.traceIndex, c.accent);
}

async function start() {
  const startButton = $('start');
  const stopButton = $('stop');
  startButton.disabled = true;
  $('source').disabled = true;
  setStatus('starting', 'warn');
  try {
    const context = new AudioContext();
    live.context = context;
    if (context.state === 'suspended') await context.resume();
    await context.audioWorklet.addModule('./lib/worklet.js');

    const node = new AudioWorkletNode(context, 'frequency-analyser', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: {
        fftSize: live.fftSize,
        sampleRate: context.sampleRate,
        messageEvery: 1,
      },
    });
    live.node = node;
    node.port.onmessage = onPacket;
    node.connect(context.destination);

    const kind = $('source').value;
    live.source =
      kind === 'microphone'
        ? await createMicrophoneSource(context, node)
        : createTestSignal(context, node);

    live.packets = 0;
    live.beats = 0;
    live.latest = null;
    live.interpolator.reset();
    live.rawTrace.fill(0);
    live.smoothTrace.fill(0);
    live.startedAt = performance.now();
    $('sample-rate').textContent = `${context.sampleRate} Hz`;
    $('fft-size').textContent = `${live.fftSize} (${live.fftSize / 2} bins)`;
    setStatus(
      kind === 'microphone' ? 'live: microphone' : 'live: test signal',
      'ok',
    );
    stopButton.disabled = false;
    live.raf = requestAnimationFrame(renderFrame);
  } catch (error) {
    setStatus(`failed: ${error.message}`, 'bad');
    await stop();
  }
}

async function stop() {
  cancelAnimationFrame(live.raf);
  live.raf = 0;
  if (live.source) {
    try {
      live.source.stop();
    } catch {
      // Nothing left to stop.
    }
    live.source = null;
  }
  if (live.node) {
    live.node.port.onmessage = null;
    live.node.disconnect();
    live.node = null;
  }
  if (live.context) {
    try {
      await live.context.close();
    } catch {
      // Already closed.
    }
    live.context = null;
  }
  $('start').disabled = !supportsWorklet;
  $('source').disabled = false;
  $('stop').disabled = true;
  $('beat-dot').style.setProperty('--intensity', '0');
  if ($('demo-status').textContent.startsWith('live')) setStatus('stopped');
}

function initLiveDemo() {
  if (!supportsWorklet) {
    $('worklet-notice').hidden = false;
    $('start').disabled = true;
    setStatus('unavailable', 'bad');
  } else {
    setStatus('idle');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    $('source').querySelector('option[value="microphone"]').disabled = true;
  }
  $('start').addEventListener('click', start);
  $('stop').addEventListener('click', stop);
  // Draw the empty canvases once so the layout is visible before Start.
  drawSpectrum();
  drawWaveform();
  const c = palette();
  drawTrace($('trace-raw'), live.rawTrace, 0, c.muted);
  drawTrace($('trace-smooth'), live.smoothTrace, 0, c.accent);
}

try {
  runOfflineDemo();
} catch (error) {
  $('offline-summary').textContent = `offline demo failed: ${error.message}`;
}
initLiveDemo();
