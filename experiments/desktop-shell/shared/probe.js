// Measurement probe for the desktop-shell spike. The shells inject it at
// document start only when STIMS_SPIKE_COLLECTOR is set; a plain run loads the
// app with no probe at all. It never touches the app's own state. It counts
// raw rAF and timer ticks, times Stims's worklet messages, and taps a clone of
// the captured stream so each latency stage has its own timestamp.
(() => {
  const config = window.__STIMS_SPIKE__;
  if (!config?.collector || window.__spikeProbe) return;

  // Low enough for the -40 dBFS bursts the latency runs play: a capture path
  // has a digital-zero floor, so quiet bursts are still unambiguous.
  const THRESHOLD = config.threshold ?? 0.004;
  const QUIET_MS = 150;
  const collector = config.collector;
  const shell = config.shell;
  const events = [];

  const post = (path, body) =>
    fetch(collector + path, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ shell, ...body }),
    }).catch(() => {});

  const quantile = (values, q) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  };

  // Main-thread time inside rAF callbacks, this probe's own excluded. GPU work
  // is not in it, so read it next to the frame cadence.
  const nativeRaf = window.requestAnimationFrame.bind(window);
  let callbackMs = [];
  window.requestAnimationFrame = (callback) =>
    nativeRaf((timestamp) => {
      const start = performance.now();
      callback(timestamp);
      callbackMs.push(performance.now() - start);
    });

  // Raw rAF, independent of Stims's own loop.
  let rafCount = 0;
  let rafLast = 0;
  let rafDeltas = [];
  const rafWaiters = [];
  const onRaf = (timestamp) => {
    rafCount += 1;
    if (rafLast) rafDeltas.push(timestamp - rafLast);
    rafLast = timestamp;
    if (rafWaiters.length) {
      const now = Date.now();
      for (const waiter of rafWaiters.splice(0)) waiter(now);
    }
    nativeRaf(onRaf);
  };
  nativeRaf(onRaf);

  // What Stims actually drew. A WebGPU canvas takes one texture per presented
  // frame, so this separates "rAF fired" from "the engine rendered".
  let presents = 0;
  const wrap = (proto, name) => {
    const original = proto?.[name];
    if (!original) return;
    proto[name] = function (...args) {
      presents += 1;
      return original.apply(this, args);
    };
  };
  wrap(window.GPUCanvasContext?.prototype, 'getCurrentTexture');

  // A 100 ms timer, to tell rAF stopping apart from the whole page freezing.
  let ticks = 0;
  setInterval(() => {
    ticks += 1;
  }, 100);

  // Stims's analysis messages. A message's rms is the peak since the last
  // post, so its first loud message marks when the burst reached the app.
  let lastLoudAt = 0;
  let analysisMessages = 0;
  let analysisPeak = 0;
  const onAnalysis = (data) => {
    analysisMessages += 1;
    if (data.rms > analysisPeak) analysisPeak = data.rms;
    if (data.rms < THRESHOLD) return;
    const now = Date.now();
    const isOnset = now - lastLoudAt > QUIET_MS;
    lastLoudAt = now;
    if (!isOnset) return;
    const event = { kind: 'analysis', t: now, rms: data.rms, raf: null };
    events.push(event);
    rafWaiters.push((rafAt) => {
      event.raf = rafAt;
    });
  };
  const portDescriptor = Object.getOwnPropertyDescriptor(
    MessagePort.prototype,
    'onmessage',
  );
  if (portDescriptor?.set) {
    Object.defineProperty(MessagePort.prototype, 'onmessage', {
      configurable: true,
      get() {
        return portDescriptor.get.call(this);
      },
      set(handler) {
        if (typeof handler !== 'function') {
          portDescriptor.set.call(this, handler);
          return;
        }
        portDescriptor.set.call(this, (event) => {
          if (typeof event.data?.rms === 'number') onAnalysis(event.data);
          return handler.call(this, event);
        });
      },
    });
  }

  // Taps a clone of whatever stream Stims connects, on its own context, so the
  // stream's arrival is timed apart from Stims's analysis window.
  const tapSource = `
    class SpikeTap extends AudioWorkletProcessor {
      constructor(options) {
        super();
        this.threshold = options.processorOptions.threshold;
        this.lastLoud = 0;
      }
      process(inputs) {
        const channel = inputs[0]?.[0];
        if (!channel) return true;
        for (let i = 0; i < channel.length; i++) {
          if (Math.abs(channel[i]) < this.threshold) continue;
          const now = Date.now();
          if (now - this.lastLoud > ${QUIET_MS}) {
            this.port.postMessage({ t: now, peak: Math.abs(channel[i]) });
          }
          this.lastLoud = now;
          break;
        }
        return true;
      }
    }
    registerProcessor('spike-tap', SpikeTap);
  `;
  const contexts = [];
  let tapStarted = false;
  const startTap = async (stream) => {
    if (tapStarted || !stream?.getAudioTracks?.().length) return;
    tapStarted = true;
    const context = new AudioContext({ latencyHint: 'interactive' });
    const url = URL.createObjectURL(
      new Blob([tapSource], { type: 'application/javascript' }),
    );
    await context.audioWorklet.addModule(url);
    const node = new AudioWorkletNode(context, 'spike-tap', {
      numberOfOutputs: 0,
      processorOptions: { threshold: THRESHOLD },
    });
    node.port.onmessage = (event) => {
      events.push({ kind: 'stream', t: event.data.t, peak: event.data.peak });
    };
    context.createMediaStreamSource(stream.clone()).connect(node);
    if (context.state !== 'running') await context.resume().catch(() => {});
    window.__spikeProbe.tapContext = context;
  };
  const createSource = AudioContext.prototype.createMediaStreamSource;
  AudioContext.prototype.createMediaStreamSource = function (stream) {
    if (!contexts.includes(this) && this !== window.__spikeProbe?.tapContext) {
      contexts.push(this);
      startTap(stream).catch((error) =>
        post('/report', { kind: 'error', message: String(error) }),
      );
    }
    return createSource.call(this, stream);
  };

  // Long-poll commands, so the same driver works in Chrome, Electron and
  // WKWebView, none of which share a debugging protocol.
  const AsyncFunction = (async () => {}).constructor;
  const pollCommands = async () => {
    for (;;) {
      try {
        const response = await fetch(
          `${collector}/cmd?shell=${encodeURIComponent(shell)}`,
        );
        const command = await response.json();
        if (command?.id) {
          // Not awaited: one slow command must not hold up the next.
          new AsyncFunction(command.code)().then(
            (value) => post('/result', { id: command.id, ok: true, value }),
            (error) =>
              post('/result', {
                id: command.id,
                ok: false,
                error: String(error),
              }),
          );
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  };
  pollCommands();

  // One line a second, measured against the clock rather than the tick count:
  // this timer is itself throttled in the states being measured.
  let reportedAt = Date.now();
  setInterval(() => {
    const now = Date.now();
    const elapsed = now - reportedAt;
    reportedAt = now;
    const telemetry = window.__STIMS_AGENT_BRIDGE__?.getTelemetry?.();
    const state = window.__stims_agent?.getState?.();
    post('/report', {
      kind: 'tick',
      t: now,
      elapsedMs: elapsed,
      raf: rafCount,
      presents,
      jsP50: quantile(callbackMs, 0.5),
      jsP95: quantile(callbackMs, 0.95),
      rafP50: quantile(rafDeltas, 0.5),
      rafP95: quantile(rafDeltas, 0.95),
      timerTicks: ticks,
      analysisMessages,
      analysisPeak,
      hidden: document.hidden,
      visibility: document.visibilityState,
      focused: document.hasFocus(),
      backend: telemetry?.backend ?? null,
      fps: telemetry?.fps ?? null,
      energy: telemetry?.audioEnergy ?? null,
      frameMs: telemetry?.quality?.averageFrameMs ?? null,
      cadenceMs: telemetry?.quality?.averageCadenceMs ?? null,
      qualityStep: telemetry?.quality?.step ?? null,
      presetId: telemetry?.currentPresetId ?? null,
      renderingSuspended: state?.renderingSuspended ?? null,
      appliedShader: state?.appliedShaderExecution ?? null,
      audioSource: state?.audioSource ?? null,
      nativeAudio: window.__stimsNativeAudio?.stats?.() ?? null,
      contexts: contexts.map((context) => ({
        state: context.state,
        rate: context.sampleRate,
        base: context.baseLatency ?? null,
        output: context.outputLatency ?? null,
      })),
      events: events.splice(0),
    });
    rafCount = 0;
    presents = 0;
    ticks = 0;
    rafDeltas = [];
    callbackMs = [];
    analysisMessages = 0;
    analysisPeak = 0;
  }, 1000);

  window.__spikeProbe = {
    config,
    note: (event) => events.push(event),
    contexts,
  };
})();
