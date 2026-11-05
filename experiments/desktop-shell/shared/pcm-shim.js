// Injected into every page the Tauri shell loads. WKWebView has no system-audio
// source, so this answers getUserMedia({ audio }) with a stream played from the
// PCM the native tap pushes through window.__stimsNativePcm. Adapted from the
// Android spike's shim (claude/projectm-replacement-apk-95d5ff).
(() => {
  if (window.__stimsNativeAudio) return;

  const RATE = window.__STIMS_NATIVE_RATE__ ?? 48000;
  const CHANNELS = 2;
  const BURST_THRESHOLD = 0.004;
  const state = {
    context: null,
    node: null,
    stream: null,
    chunks: 0,
    queuedFrames: 0,
    dropped: 0,
    underruns: 0,
    hops: [],
    lastLoudAt: 0,
  };

  // Holds at most maxFrames, so a stalled main thread cannot build up latency
  // that never drains.
  const processor = `
    class NativePcm extends AudioWorkletProcessor {
      constructor(options) {
        super();
        this.maxFrames = options.processorOptions.maxFrames;
        this.queue = [];
        this.offset = 0;
        this.dropped = 0;
        this.underruns = 0;
        this.quanta = 0;
        this.port.onmessage = (event) => {
          this.queue.push(event.data);
          while (this.queue.length > 1 && this.queuedFrames() > this.maxFrames) {
            this.queue.shift();
            this.offset = 0;
            this.dropped++;
          }
        };
      }
      queuedFrames() {
        let frames = -this.offset;
        for (const chunk of this.queue) frames += chunk.length / ${CHANNELS};
        return frames;
      }
      process(_inputs, outputs) {
        const left = outputs[0][0];
        const right = outputs[0][1] ?? left;
        let i = 0;
        while (i < left.length) {
          const head = this.queue[0];
          if (!head) {
            left.fill(0, i);
            right.fill(0, i);
            this.underruns++;
            break;
          }
          const frames = Math.min(left.length - i, head.length / ${CHANNELS} - this.offset);
          for (let f = 0; f < frames; f++) {
            const s = (this.offset + f) * ${CHANNELS};
            left[i + f] = head[s];
            right[i + f] = head[s + 1];
          }
          i += frames;
          this.offset += frames;
          if (this.offset * ${CHANNELS} >= head.length) {
            this.queue.shift();
            this.offset = 0;
          }
        }
        if (++this.quanta % 188 === 0) {
          this.port.postMessage({
            queued: this.queuedFrames(),
            dropped: this.dropped,
            underruns: this.underruns,
          });
        }
        return true;
      }
    }
    registerProcessor('stims-native-pcm', NativePcm);
  `;

  async function ensureStream() {
    if (state.stream) return state.stream;
    const context = new AudioContext({
      sampleRate: RATE,
      latencyHint: 'interactive',
    });
    const url = URL.createObjectURL(
      new Blob([processor], { type: 'application/javascript' }),
    );
    await context.audioWorklet.addModule(url);
    const blockFrames = Math.ceil((context.baseLatency || 0) * RATE);
    // The queue fills to this cap and stays there, so the cap is the latency:
    // 60 ms measured 122 ms sound-to-frame, 30 ms is what this default buys.
    // Dropped chunks cost a visualizer far less than late ones.
    const capMs = window.__STIMS_NATIVE_CAP_MS__ ?? 30;
    const capFrames = Math.ceil((RATE * capMs) / 1000);
    const node = new AudioWorkletNode(context, 'stims-native-pcm', {
      numberOfInputs: 0,
      outputChannelCount: [CHANNELS],
      processorOptions: { maxFrames: Math.max(capFrames, blockFrames * 2) },
    });
    node.port.onmessage = (event) => {
      state.queuedFrames = event.data.queued;
      state.dropped = event.data.dropped;
      state.underruns = event.data.underruns;
    };
    const destination = context.createMediaStreamDestination();
    destination.channelCount = CHANNELS;
    node.connect(destination);
    if (context.state !== 'running') await context.resume().catch(() => {});
    Object.assign(state, { context, node, stream: destination.stream });
    return destination.stream;
  }

  window.__stimsNativePcm = (nativeAt, base64) => {
    const now = Date.now();
    if (state.hops.length < 4096) state.hops.push(now - nativeAt);
    if (!state.node) return;
    const bytes = atob(base64);
    const samples = new Float32Array(bytes.length >> 1);
    let peak = 0;
    for (let i = 0, j = 0; i < samples.length; i++, j += 2) {
      const value = bytes.charCodeAt(j) | (bytes.charCodeAt(j + 1) << 8);
      const sample = (value >= 0x8000 ? value - 0x10000 : value) / 32768;
      samples[i] = sample;
      if (Math.abs(sample) > peak) peak = Math.abs(sample);
    }
    if (peak >= BURST_THRESHOLD) {
      if (now - state.lastLoudAt > 150) {
        window.__spikeProbe?.note?.({ kind: 'chunk', t: now, nativeAt, peak });
      }
      state.lastLoudAt = now;
    }
    state.node.port.postMessage(samples, [samples.buffer]);
    state.chunks++;
  };

  // WKWebView exposes mediaDevices only on a secure origin, so build it if need be.
  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(new Error('unavailable')) },
    });
  }
  const media = navigator.mediaDevices;
  const getUserMedia = media.getUserMedia.bind(media);
  media.getUserMedia = async (constraints) =>
    constraints?.audio && !constraints.video
      ? // Each caller gets a clone: Stims stops the tracks it was handed when
        // audio stops, which would otherwise silence every later start.
        (await ensureStream()).clone()
      : getUserMedia(constraints);

  // Stims refuses the microphone when this query reports denied.
  const permissions = navigator.permissions;
  if (permissions?.query) {
    const query = permissions.query.bind(permissions);
    permissions.query = (descriptor) =>
      descriptor?.name === 'microphone'
        ? Promise.resolve({
            name: 'microphone',
            state: 'granted',
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
          })
        : query(descriptor);
  }

  window.__stimsNativeAudio = {
    stats: () => {
      const hops = state.hops.splice(0).sort((a, b) => a - b);
      return {
        chunks: state.chunks,
        queuedMs: (state.queuedFrames / RATE) * 1000,
        dropped: state.dropped,
        underruns: state.underruns,
        hopP50: hops[hops.length >> 1] ?? null,
        hopP95: hops[Math.floor(hops.length * 0.95)] ?? null,
        hopMax: hops[hops.length - 1] ?? null,
        contextState: state.context?.state ?? null,
        baseLatency: state.context?.baseLatency ?? null,
        outputLatency: state.context?.outputLatency ?? null,
      };
    },
  };
})();
