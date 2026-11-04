/**
 * Measure what the GPU compute VM actually costs per frame, against the CPU JIT.
 *
 * The compute VM (src/js/milkdrop/vm-gpu.ts) runs a preset's per_frame block
 * as a WebGPU compute dispatch. `gpuComputeVM` is deliberately opt-in: the
 * measurements from this harness showed why. `vm.ts stepAsync` needs the
 * resulting state back on the CPU to build geometry, so every frame pays an
 * upload, a dispatch, and a readback — for a program whose median size is 21
 * scalar statements.
 *
 * This harness times the REAL modules (imported in-page through Vite, not
 * reimplemented here) over real preset per_frame blocks:
 *   - `gpu`: syncState + dispatch + readback, exactly what stepAsync does
 *   - `cpu`: the compiled JIT program, same block, same state
 *   - `per-vertex`: the SAME preset's per_pixel block run once per mesh
 *     point, which is the workload the GPU tier was actually built for
 *
 * The third column exists because the second one alone was used to justify
 * keeping the compute VM ("still the right vehicle for per-vertex work") and
 * that claim was asserted, not measured. Per-vertex is where thousands of
 * invocations should finally beat the round-trip latency — or not.
 *
 * Reports per-iteration median/p95 microseconds for each tier and the ratio,
 * so "is the GPU tier worth it" is a measurement rather than an argument.
 *
 * It also answers "did a browser's faster queue writes move anything", which
 * the round trip alone cannot (issue #1541):
 *   - `upload` columns time `syncState` on its own inside the GPU tier
 *   - a size sweep times bare `writeBuffer`/`writeTexture` calls, both the call
 *     and the call plus `onSubmittedWorkDone`
 *   - `--live <preset,preset>` plays each preset on the real WebGPU renderer
 *     and reports queue writes per frame, the render passes and the textures
 *   - a platform probe records the adapter and which transient-attachment and
 *     canvas colour-space configurations this build accepts
 *
 * The page is served cross-origin isolated so `performance.now()` resolves 5us
 * rather than 100us. Timings mean little on a loaded host or a software
 * adapter, so every run prints the load average and the adapter beside them.
 *
 *   bun run lab:vm-tier-bench
 *   bun run lab:vm-tier-bench -- --iterations 300
 *   bun run lab:vm-tier-bench -- --executable <path> --live eos-apocalypse --json out.json
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { type Browser, chromium, type Page } from 'playwright';
import { ensureDevServer } from './dev-server.ts';

const args = process.argv.slice(2);
function stringFlag(name: string) {
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  return args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}
function flag(name: string, fallback: number) {
  const value = stringFlag(name);
  return value === undefined ? fallback : Number(value);
}
const PORT = flag('port', 5198);
const ITERATIONS = flag('iterations', 200);
/** A browser build to time instead of Playwright's default headless shell. */
const EXECUTABLE = stringFlag('executable');
const LIVE_PRESETS = stringFlag('live')?.split(',') ?? [];
const JSON_PATH = stringFlag('json');

/** MilkDrop's default mesh; the per-vertex program runs once per point. */
const MESH_POINTS = 48 * 36;

type TierStats = { median: number; p95: number };

type BenchRow = {
  id: string;
  statements: number;
  compiledFrameStatements?: number;
  pixelStatements?: number;
  compiledPixelStatements?: number;
  usesGuestMemory?: boolean;
  gpuExecutable?: boolean;
  cpu?: TierStats;
  gpu?: TierStats | null;
  /** `syncState` alone: the queue writes inside the `gpu` figure. */
  upload?: TierStats | null;
  perVertex?: TierStats | null;
  error?: string;
};

type Sample = {
  id: string;
  statements: number;
  usesGuestMemory: boolean;
  lines: string[];
  pixelLines: string[];
};

function collectPresets(): Sample[] {
  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.milk')) files.push(path);
    }
  })('public/milkdrop-presets');
  files.sort();

  const parsed = files
    .map((file) => {
      const lines = readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter((line) => /^per_frame_[0-9]+=/i.test(line))
        .map((line) => line.replace(/^[^=]*=/, '').trim())
        .filter(Boolean);
      const pixelLines = readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter((line) => /^per_pixel_[0-9]+=/i.test(line))
        .map((line) => line.replace(/^[^=]*=/, '').trim())
        .filter(Boolean);
      const source = lines.join('\n');
      return {
        pixelLines,
        id:
          file
            .split('/')
            .pop()
            ?.replace(/\.milk$/, '') ?? file,
        statements: lines.length,
        usesGuestMemory: /\bg?megabuf\b/i.test(source),
        lines,
      };
    })
    .filter((entry) => entry.statements > 0);

  const bySize = [...parsed].sort((a, b) => a.statements - b.statements);
  const at = (p: number) =>
    bySize[
      Math.min(bySize.length - 1, Math.floor(bySize.length * p))
    ] as Sample;
  const guest = parsed.find((entry) => entry.usesGuestMemory);

  // Median / p90 / p99 by program size, plus one guest-memory user (2.3% of
  // the corpus, but the only case that moves 8 MiB per frame).
  // Presets whose per_pixel block is substantial: the per-frame percentiles
  // above are mostly shader-era presets with no per_pixel equations at all,
  // which cannot exercise the per-vertex column.
  const byPixel = [...parsed].sort(
    (a, b) => b.pixelLines.length - a.pixelLines.length,
  );
  const picks = [
    at(0.5),
    at(0.9),
    at(0.99),
    ...(guest ? [guest] : []),
    ...byPixel.slice(0, 3),
  ];
  const seen = new Set<string>();
  return picks.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

/** Fine timers: an isolated page's clock resolves 5us instead of 100us. */
async function serveCrossOriginIsolated(page: Page) {
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          'cross-origin-opener-policy': 'same-origin',
          'cross-origin-embedder-policy': 'credentialless',
        },
      });
    },
  );
}

/** What this build and adapter accept, recorded beside the timings. */
async function probePlatform() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const attempt = async (build: () => unknown) => {
    device.pushErrorScope('validation');
    let threw: string | null = null;
    try {
      build();
    } catch (error) {
      threw = String(error);
    }
    const scoped = await device.popErrorScope();
    if (threw) return `threw: ${threw.slice(0, 160)}`;
    return scoped ? `rejected: ${scoped.message.slice(0, 160)}` : 'accepted';
  };

  const canvasConfigurations: Record<string, string> = {};
  for (const format of ['bgra8unorm', 'rgba16float'] as const) {
    for (const colorSpace of [
      'srgb',
      'display-p3',
      'srgb-linear',
      'display-p3-linear',
    ]) {
      const context = document.createElement('canvas').getContext('webgpu');
      if (!context) continue;
      canvasConfigurations[`${format} ${colorSpace}`] = await attempt(() =>
        context.configure({
          device,
          format,
          colorSpace: colorSpace as PredefinedColorSpace,
        }),
      );
    }
  }

  const transientUsage = (GPUTextureUsage as unknown as Record<string, number>)
    .TRANSIENT_ATTACHMENT;
  const transient: Record<string, string> = {};
  if (transientUsage !== undefined) {
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | transientUsage;
    const color = (extraUsage = 0) =>
      device.createTexture({
        size: [16, 16],
        format: 'rgba8unorm',
        usage: usage | extraUsage,
      });
    const colorPass = (storeOp: GPUStoreOp) => {
      const encoder = device.createCommandEncoder();
      encoder
        .beginRenderPass({
          colorAttachments: [
            { view: color().createView(), loadOp: 'clear', storeOp },
          ],
        })
        .end();
      encoder.finish();
    };
    transient['color texture'] = await attempt(() => color());
    transient['color texture also sampled'] = await attempt(() =>
      color(GPUTextureUsage.TEXTURE_BINDING),
    );
    transient['color pass clear+discard'] = await attempt(() =>
      colorPass('discard'),
    );
    transient['color pass clear+store'] = await attempt(() =>
      colorPass('store'),
    );
    transient['depth pass clear+discard'] = await attempt(() => {
      const encoder = device.createCommandEncoder();
      encoder
        .beginRenderPass({
          colorAttachments: [
            {
              view: device
                .createTexture({
                  size: [16, 16],
                  format: 'rgba8unorm',
                  usage: GPUTextureUsage.RENDER_ATTACHMENT,
                })
                .createView(),
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
          depthStencilAttachment: {
            view: device
              .createTexture({
                size: [16, 16],
                format: 'depth24plus',
                usage,
              })
              .createView(),
            depthLoadOp: 'clear',
            depthClearValue: 1,
            depthStoreOp: 'discard',
          },
        })
        .end();
      encoder.finish();
    });
  }
  device.destroy();

  return {
    adapter: {
      vendor: adapter.info.vendor,
      architecture: adapter.info.architecture,
      isFallbackAdapter: adapter.info.isFallbackAdapter,
    },
    crossOriginIsolated,
    colorGamutP3: matchMedia('(color-gamut: p3)').matches,
    preferredCanvasFormat: navigator.gpu.getPreferredCanvasFormat(),
    transientAttachmentFlag: transientUsage !== undefined,
    transient,
    canvasConfigurations,
  };
}

/**
 * Bare queue writes across the sizes the runtime uses: 256 B signal block, a
 * 4 KiB state block and audio texture, geometry-sized buffers, and the 4 MiB
 * guest memory. Each batch moves enough bytes to outlast the timer.
 */
async function measureQueueWrites() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return [];
  const device = await adapter.requestDevice();
  const stats = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const pick = (p: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
    return { median: pick(0.5), p95: pick(0.95) };
  };
  const BATCHES = 60;
  const timeWrites = async (kind: string, bytes: number, write: () => void) => {
    const writesPerBatch = Math.min(256, Math.ceil((4 * 1024 * 1024) / bytes));
    const call: number[] = [];
    const total: number[] = [];
    for (let batch = 0; batch < BATCHES; batch += 1) {
      const t0 = performance.now();
      for (let i = 0; i < writesPerBatch; i += 1) write();
      const t1 = performance.now();
      await device.queue.onSubmittedWorkDone();
      const t2 = performance.now();
      call.push(((t1 - t0) * 1000) / writesPerBatch);
      total.push(((t2 - t0) * 1000) / writesPerBatch);
    }
    return {
      kind,
      bytes,
      writesPerBatch,
      call: stats(call),
      total: stats(total),
    };
  };

  const rows = [];
  for (const bytes of [256, 4096, 65536, 1048576, 4194304]) {
    const buffer = device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const data = new Uint8Array(bytes);
    rows.push(
      await timeWrites('writeBuffer', bytes, () =>
        device.queue.writeBuffer(buffer, 0, data),
      ),
    );
    buffer.destroy();
  }
  for (const [width, height] of [
    [512, 2],
    [1024, 1024],
  ] as const) {
    const texture = device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const bytes = width * height * 4;
    const data = new Uint8Array(bytes);
    rows.push(
      await timeWrites('writeTexture', bytes, () =>
        device.queue.writeTexture(
          { texture },
          data,
          { bytesPerRow: width * 4, rowsPerImage: height },
          [width, height],
        ),
      ),
    );
    texture.destroy();
  }
  device.destroy();
  return rows;
}

/** Wraps the WebGPU entry points a frame's uploads and passes go through. */
function installFrameProbe() {
  if (typeof GPUQueue === 'undefined') return;
  type Described = {
    format: string;
    usage: number;
    width: number;
    height: number;
    samples: number;
    alive: boolean;
  };
  const counters = {
    bufferCalls: 0,
    bufferBytes: 0,
    bufferMs: 0,
    textureCalls: 0,
    textureBytes: 0,
    textureMs: 0,
  };
  const textures = new Map<GPUTexture, Described>();
  const views = new WeakMap<GPUTextureView, Described>();
  const passes = new Map<string, number>();

  const { writeBuffer, writeTexture } = GPUQueue.prototype;
  GPUQueue.prototype.writeBuffer = function (
    this: GPUQueue,
    ...call: unknown[]
  ) {
    const t0 = performance.now();
    const result = Reflect.apply(writeBuffer, this, call);
    counters.bufferMs += performance.now() - t0;
    counters.bufferCalls += 1;
    counters.bufferBytes +=
      (call[2] as ArrayBufferView | ArrayBuffer).byteLength ?? 0;
    return result;
  } as typeof writeBuffer;
  GPUQueue.prototype.writeTexture = function (
    this: GPUQueue,
    ...call: unknown[]
  ) {
    const t0 = performance.now();
    const result = Reflect.apply(writeTexture, this, call);
    counters.textureMs += performance.now() - t0;
    counters.textureCalls += 1;
    counters.textureBytes +=
      (call[1] as ArrayBufferView | ArrayBuffer).byteLength ?? 0;
    return result;
  } as typeof writeTexture;

  const { createTexture } = GPUDevice.prototype;
  GPUDevice.prototype.createTexture = function (
    this: GPUDevice,
    descriptor: GPUTextureDescriptor,
  ) {
    const texture = createTexture.call(this, descriptor);
    textures.set(texture, {
      format: texture.format,
      usage: texture.usage,
      width: texture.width,
      height: texture.height,
      samples: texture.sampleCount,
      alive: true,
    });
    return texture;
  };
  const { destroy, createView } = GPUTexture.prototype;
  GPUTexture.prototype.destroy = function (this: GPUTexture) {
    const described = textures.get(this);
    if (described) described.alive = false;
    return destroy.call(this);
  };
  GPUTexture.prototype.createView = function (
    this: GPUTexture,
    descriptor?: GPUTextureViewDescriptor,
  ) {
    const view = createView.call(this, descriptor);
    views.set(view, {
      format: this.format,
      usage: this.usage,
      width: this.width,
      height: this.height,
      samples: this.sampleCount,
      alive: true,
    });
    return view;
  };

  const { beginRenderPass } = GPUCommandEncoder.prototype;
  GPUCommandEncoder.prototype.beginRenderPass = function (
    this: GPUCommandEncoder,
    descriptor: GPURenderPassDescriptor,
  ) {
    const label = (view: GPUTexture | GPUTextureView | undefined | null) => {
      const described = view ? views.get(view as GPUTextureView) : undefined;
      return described
        ? `${described.format} ${described.width}x${described.height}`
        : 'unknown';
    };
    const [color] = Array.from(descriptor.colorAttachments);
    const depth = descriptor.depthStencilAttachment;
    const key = `color ${label(color?.view)} ${color?.loadOp}/${color?.storeOp} | depth ${
      depth
        ? `${label(depth.view)} ${depth.depthLoadOp}/${depth.depthStoreOp}`
        : 'none'
    }`;
    passes.set(key, (passes.get(key) ?? 0) + 1);
    return beginRenderPass.call(this, descriptor);
  };

  (window as unknown as { __frameProbe: unknown }).__frameProbe = {
    counters,
    passes,
    aliveTextures: () => [...textures.values()].filter((t) => t.alive),
  };
}

/** Queue writes, passes and textures of the real WebGPU renderer, per frame. */
async function measureLive(browser: Browser, presetId: string) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(String(error)));
  await serveCrossOriginIsolated(page);
  await page.addInitScript(installFrameProbe);
  await page.goto(
    `http://127.0.0.1:${PORT}/?agent=true&renderer=webgpu&mockAudio=demo&lockQualityStep=0&preset=${presetId}`,
    { waitUntil: 'domcontentloaded' },
  );
  const WINDOWS = 8;
  const FRAMES = 120;
  const measured = await page.evaluate(
    async ({ windows, framesPerWindow }) => {
      type Agent = {
        getState: () => Record<string, unknown> | undefined;
        run: (id: string) => Promise<unknown>;
      };
      const frameWindow = window as unknown as {
        __stims_agent?: Agent;
        __frameProbe: {
          counters: Record<string, number>;
          passes: Map<string, number>;
          aliveTextures: () => {
            format: string;
            usage: number;
            width: number;
            height: number;
            samples: number;
          }[];
        };
      };
      const frames = (count: number) =>
        new Promise<void>((resolve) => {
          let left = count;
          const tick = () => {
            left -= 1;
            if (left <= 0) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      const deadline = performance.now() + 60_000;
      while (frameWindow.__stims_agent?.getState()?.engineState !== 'live') {
        if (performance.now() > deadline) {
          return { error: 'engine never went live' };
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await frameWindow.__stims_agent.run('audio-demo');
      await frames(240);

      const probe = frameWindow.__frameProbe;
      const samples: Record<string, number>[] = [];
      for (let w = 0; w < windows; w += 1) {
        for (const key of Object.keys(probe.counters)) probe.counters[key] = 0;
        probe.passes.clear();
        const t0 = performance.now();
        await frames(framesPerWindow);
        const wallMs = performance.now() - t0;
        samples.push({
          frameMs: wallMs / framesPerWindow,
          ...Object.fromEntries(
            Object.entries(probe.counters).map(([key, value]) => [
              key,
              value / framesPerWindow,
            ]),
          ),
        });
      }
      const state = frameWindow.__stims_agent.getState();
      return {
        presetId: state?.presetId,
        backend: state?.backend ?? state?.renderer,
        samples,
        passesPerFrame: Object.fromEntries(
          [...probe.passes].map(([key, count]) => [
            key,
            count / framesPerWindow,
          ]),
        ),
        aliveTextures: probe.aliveTextures(),
      };
    },
    { windows: WINDOWS, framesPerWindow: FRAMES },
  );
  await context.close();
  return { ...measured, browserErrors };
}

const samples = collectPresets();
console.log(
  `Benchmarking ${samples.length} per_frame blocks x ${ITERATIONS} iterations:\n` +
    samples
      .map(
        (s) =>
          `  ${s.id} — ${s.statements} statements${s.usesGuestMemory ? ', uses guest memory' : ''}`,
      )
      .join('\n'),
);

const server = await ensureDevServer(PORT, process.cwd());
const browser = await chromium.launch({
  headless: true,
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const loadAtStart = loadavg();

try {
  const page = await browser.newPage();
  await serveCrossOriginIsolated(page);
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`  [page] ${message.text()}`);
  });
  await page.goto(`http://127.0.0.1:${PORT}/?agent=true`, {
    waitUntil: 'domcontentloaded',
  });
  if (!(await page.evaluate(() => 'gpu' in navigator))) {
    throw new Error('navigator.gpu unavailable in this Chromium.');
  }

  const results = await page.evaluate(
    async ({ pageSamples, iterations, meshPoints }) => {
      // Vite serves these from the dev server; the specifiers are URLs, not
      // paths tsc can resolve, so they go through a variable to keep the
      // module graph out of the typecheck.
      const load = (specifier: string) =>
        import(/* @vite-ignore */ specifier) as Promise<
          Record<string, CallableFunction>
        >;
      const [
        { parseMilkdropStatement, splitMilkdropStatements },
        { compileMilkdropProgram },
        { createGpuVmRunner },
      ] = await Promise.all([
        load('/packages/milkdrop-toolchain/src/expression.ts'),
        load('/packages/milkdrop-toolchain/src/expression-jit.ts'),
        load('/src/js/milkdrop/vm-gpu.ts'),
      ]);

      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return { error: 'no WebGPU adapter' };
      const device = await adapter.requestDevice();

      const stats = (values: number[]) => {
        const sorted = [...values].sort((a, b) => a - b);
        const pick = (p: number) =>
          sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
        return { median: pick(0.5), p95: pick(0.95) };
      };

      // Split each source line the way the compiler does before parsing it.
      // Feeding whole lines straight to parseMilkdropStatement dropped EVERY
      // real preset statement -- a trailing ';' is a parse error for an
      // assignment -- so an earlier run of this harness timed an empty
      // program and reported CPU cost as 0.000us. The src/compiled counts in
      // the output exist so that can never pass unnoticed again.
      const parseBlock = (lines: string[]) => {
        const statements: unknown[] = [];
        for (const [index, line] of lines.entries()) {
          for (const piece of splitMilkdropStatements(line)) {
            const parsed = parseMilkdropStatement(piece, index + 1);
            if (
              parsed.value &&
              !parsed.diagnostics.some(
                (d: { severity: string }) => d.severity === 'error',
              )
            ) {
              statements.push(parsed.value);
            }
          }
        }
        return { statements, sourceLines: lines };
      };

      const signals = {
        time: 1,
        frame: 1,
        fps: 60,
        bass: 1,
        mid: 1,
        treb: 1,
        vol: 1,
      };
      const out: BenchRow[] = [];

      for (const sample of pageSamples) {
        const state: Record<string, number> = {
          zoom: 1,
          rot: 0,
          warp: 1,
          decay: 0.98,
        };
        const registers: Record<string, number> = {};

        // ── CPU tier ────────────────────────────────────────────────────
        const cpuBlock = parseBlock(sample.lines);
        const compiledFrameStatements = cpuBlock.statements.length;
        const cpuFn = compileMilkdropProgram(cpuBlock);
        const megabuf = new Float32Array(1048576);
        const gmegabuf = new Float32Array(1048576);
        const cpuEnv = { ...state };
        const cpuState = { ...state };
        const rnd = () => 0.5;
        for (let i = 0; i < 200; i += 1)
          cpuFn(cpuEnv, cpuState, {}, null, megabuf, gmegabuf, rnd);
        // performance.now() is clamped to ~100us in Chromium, which is far
        // coarser than one CPU-tier call. Time a BATCH and divide, then take
        // the median across batches.
        const BATCH = 2000;
        const cpuTimes: number[] = [];
        for (let batch = 0; batch < 20; batch += 1) {
          const t0 = performance.now();
          for (let i = 0; i < BATCH; i += 1) {
            cpuFn(cpuEnv, cpuState, {}, null, megabuf, gmegabuf, rnd);
          }
          cpuTimes.push(((performance.now() - t0) * 1000) / BATCH);
        }

        // ── Per-vertex CPU tier ─────────────────────────────────────────
        // One evaluation per mesh point, which is what the renderer actually
        // does for a per_pixel block.
        let perVertex: { median: number; p95: number } | null = null;
        let compiledPixelStatements = 0;
        if (sample.pixelLines.length > 0) {
          const pixelBlock = parseBlock(sample.pixelLines);
          compiledPixelStatements = pixelBlock.statements.length;
          const pixelFn = compileMilkdropProgram(pixelBlock);
          const pixelEnv: Record<string, number> = {
            ...state,
            x: 0.5,
            y: 0.5,
            rad: 0.5,
            ang: 0,
          };
          const pixelState = { ...state };
          for (let i = 0; i < 5; i += 1) {
            for (let p = 0; p < meshPoints; p += 1) {
              pixelFn(pixelEnv, pixelState, {}, null, megabuf, gmegabuf, rnd);
            }
          }
          // Ten frames per timing window: a single mesh pass on a short
          // program lands under the ~100us performance.now() clamp.
          const FRAMES_PER_BATCH = 10;
          const frameTimes: number[] = [];
          for (let f = 0; f < 20; f += 1) {
            const t0 = performance.now();
            for (let r = 0; r < FRAMES_PER_BATCH; r += 1) {
              for (let p = 0; p < meshPoints; p += 1) {
                pixelFn(pixelEnv, pixelState, {}, null, megabuf, gmegabuf, rnd);
              }
            }
            frameTimes.push(
              ((performance.now() - t0) * 1000) / FRAMES_PER_BATCH,
            );
          }
          perVertex = stats(frameTimes);
        }

        // ── GPU tier ────────────────────────────────────────────────────
        const runner = createGpuVmRunner();
        const gpuBlock = parseBlock(sample.lines);
        const gpuTimes: number[] = [];
        const uploadTimes: number[] = [];
        let initialized = false;
        try {
          initialized = runner.init(device, gpuBlock, state, 1, registers, {});
          if (initialized) {
            for (let i = 0; i < 5; i += 1) {
              runner.syncState(state, registers, 1);
              await runner.dispatch(signals);
            }
            for (let i = 0; i < iterations; i += 1) {
              const t0 = performance.now();
              runner.syncState(state, registers, 1);
              uploadTimes.push((performance.now() - t0) * 1000);
              await runner.dispatch(signals);
              gpuTimes.push((performance.now() - t0) * 1000);
            }
          }
        } catch (error) {
          out.push({
            id: sample.id,
            statements: sample.statements,
            error: String(error),
          });
          runner.dispose?.();
          continue;
        }
        runner.dispose?.();

        out.push({
          id: sample.id,
          statements: sample.statements,
          usesGuestMemory: sample.usesGuestMemory,
          gpuExecutable: initialized,
          cpu: stats(cpuTimes),
          gpu: initialized ? stats(gpuTimes) : null,
          upload: initialized ? stats(uploadTimes) : null,
          perVertex,
          compiledFrameStatements,
          pixelStatements: sample.pixelLines.length,
          compiledPixelStatements,
        });
      }
      return { results: out };
    },
    { pageSamples: samples, iterations: ITERATIONS, meshPoints: MESH_POINTS },
  );

  if ('error' in results && results.error) {
    throw new Error(results.error as string);
  }

  const platform = await page.evaluate(probePlatform);
  const uploads = await page.evaluate(measureQueueWrites);
  const live = [];
  for (const presetId of LIVE_PRESETS) {
    live.push(await measureLive(browser, presetId));
  }
  const loadAtEnd = loadavg();

  console.log(`\n  browser ${browser.version()}`);
  console.log(
    `  load average ${loadAtStart[0]?.toFixed(2)} at start, ${loadAtEnd[0]?.toFixed(2)} at end`,
  );
  console.log(`  platform ${JSON.stringify(platform, null, 2)}`);
  console.log(
    '\n  queue write            size   writes   call µs (p50/p95)   call+done µs (p50/p95)',
  );
  for (const row of uploads) {
    console.log(
      `  ${row.kind.padEnd(14)}${String(row.bytes).padStart(13)}${String(row.writesPerBatch).padStart(9)}   ${row.call.median.toFixed(1).padStart(8)} /${row.call.p95.toFixed(1).padStart(8)}   ${row.total.median.toFixed(1).padStart(9)} /${row.total.p95.toFixed(1).padStart(9)}`,
    );
  }
  if (live.length > 0) console.log(`  live ${JSON.stringify(live, null, 2)}`);
  if (JSON_PATH) {
    writeFileSync(
      JSON_PATH,
      `${JSON.stringify(
        {
          browser: browser.version(),
          executable: EXECUTABLE ?? 'playwright default headless shell',
          iterations: ITERATIONS,
          loadAverage1m: { start: loadAtStart[0], end: loadAtEnd[0] },
          platform,
          results: (results as { results: BenchRow[] }).results,
          uploads,
          live,
        },
        null,
        2,
      )}\n`,
    );
  }

  console.log(
    '\n  program                                     stmts   CPU µs   GPU µs    ratio   pixel stmts  per-vertex µs  upload µs',
  );
  console.log(`  ${'-'.repeat(78)}`);
  for (const row of (results as { results: BenchRow[] }).results) {
    const name = String(row.id).slice(0, 40).padEnd(42);
    if (row.error) {
      console.log(
        `  ${name}${String(row.statements).padStart(5)}   ERROR: ${row.error}`,
      );
      continue;
    }
    if (!row.gpuExecutable || !row.gpu || !row.cpu) {
      console.log(
        `  ${name}${String(row.statements).padStart(5)}   ${row.cpu ? row.cpu.median.toFixed(2).padStart(7) : '       -'}   (not GPU-executable)`,
      );
      continue;
    }
    const ratio = row.gpu.median / Math.max(row.cpu.median, 1e-6);
    const pv = row.perVertex
      ? `${row.perVertex.median.toFixed(0).padStart(9)}`
      : '        -';
    console.log(
      `  ${name}${`${row.statements}/${row.compiledFrameStatements ?? 0}`.padStart(9)}   ${row.cpu.median.toFixed(3).padStart(7)}   ${row.gpu.median.toFixed(1).padStart(7)}   ${ratio.toFixed(0).padStart(6)}x   ${`${row.pixelStatements ?? 0}/${row.compiledPixelStatements ?? 0}`.padStart(8)}  ${pv}  ${(row.upload?.median ?? 0).toFixed(1).padStart(9)}`,
    );
  }
  console.log(
    '\n  (median per iteration; GPU = syncState + dispatch + readback, as stepAsync does)',
  );
} finally {
  await browser.close();
  server?.close?.();
}
