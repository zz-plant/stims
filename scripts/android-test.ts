#!/usr/bin/env bun
/**
 * Runs the visualizer on a real Android phone over ADB and reports its device
 * diagnostics.
 *
 * Starts a LAN-visible Vite dev server, connects to the handset (pass an
 * `ip[:port]` argument for wireless ADB, otherwise USB), reverse-forwards the
 * dev port, opens Chrome on the device, and attaches over CDP to log user
 * agent, WebGPU adapter, hardware concurrency/memory, resolved device tier and
 * quality preset, a 2s FPS sample, and live telemetry.
 */
import { $ } from 'bun';
// @ts-expect-error - resolved at runtime via vite
import { createServer } from 'vite';

const DEV_SERVER_PORT = 5173;

const args = process.argv.slice(2);
const deviceIp = args.find((a) =>
  /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(a),
);
const _headless = args.includes('--headless');

function log(label: string, msg: string) {
  console.log(`[${label}] ${msg}`);
}

function warn(label: string, msg: string) {
  console.warn(`[${label}] ⚠ ${msg}`);
}

async function sh(...parts: string[]) {
  const result = await $`${parts}`.quiet().nothrow();
  return {
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
    exitCode: result.exitCode,
  };
}

async function startDevServer() {
  for (const port of [DEV_SERVER_PORT, 5174, 5175, 5176]) {
    try {
      const server = await createServer({
        server: { host: '0.0.0.0', port, strictPort: true },
        logLevel: 'silent',
      });
      await server.listen();
      const url =
        server.resolvedUrls?.local?.[0] ?? `http://localhost:${port}/`;
      log('dev', `server at ${url}`);
      return { server, url, port };
    } catch (err) {
      if (String(err).includes('already in use')) continue;
      throw err;
    }
  }
  console.warn(
    '[dev] no free port found, assuming existing dev server on 5173',
  );
  return {
    server: null,
    url: `http://localhost:${DEV_SERVER_PORT}/`,
    port: DEV_SERVER_PORT,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function connectDevice(ip?: string) {
  const adbCheck = await $`which adb`.quiet().nothrow();
  if (adbCheck.exitCode !== 0) {
    console.error('[adb] not found. Install Android platform-tools.');
    process.exit(1);
  }

  if (ip) {
    const target = ip.includes(':') ? ip : `${ip}:5555`;
    log('adb', `connecting to ${target}...`);
    const conn = await sh('adb', 'connect', target);
    if (conn.exitCode !== 0 || conn.stderr.includes('failed')) {
      console.error(`[adb] failed to connect to ${target}`);
      process.exit(1);
    }
    log('adb', `connected to ${target}`);
  }

  const devices = await $`adb devices`.quiet().nothrow();
  const lines = devices.stdout.toString().trim().split('\n').slice(1);
  const connected = lines.filter(
    (l) =>
      l.includes('device') &&
      !l.includes('unauthorized') &&
      !l.includes('offline'),
  );
  if (connected.length === 0) {
    console.error(
      '[adb] no device connected. Plug in USB or use wireless ADB.',
    );
    process.exit(1);
  }
  log('adb', `device: ${connected[0].split(/\s+/)[0]}`);
}

async function ensureChromeDebug() {
  const result = await sh('adb', 'shell', 'echo', 'ok');
  if (result.exitCode !== 0) {
    console.error('[adb] device not reachable');
    process.exit(1);
  }
}

async function openChrome(url: string) {
  log('chrome', 'opening on device...');
  await sh(
    'adb',
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    url,
    'com.android.chrome',
  );
  await sleep(2000);
}

async function setupCdpForward(port: number = DEV_SERVER_PORT) {
  const rev = await sh('adb', 'reverse', `tcp:${port}`, `tcp:${port}`);
  if (rev.exitCode === 0) {
    log('adb', `reversed tcp:${port} -> tcp:${port}`);
  } else {
    warn('adb', `reverse tcp:${port} failed: ${rev.stderr}`);
  }
  const fwd = await sh(
    'adb',
    'forward',
    'tcp:9222',
    'localabstract:chrome_devtools_remote',
  );
  if (fwd.exitCode !== 0) {
    warn('cdp', 'port 9222 forward failed, trying kill + retry');
    await sh('adb', 'forward', '--remove', 'tcp:9222');
    await sleep(500);
    await sh(
      'adb',
      'forward',
      'tcp:9222',
      'localabstract:chrome_devtools_remote',
    );
  }
}

async function getPageTarget(): Promise<string | null> {
  for (let i = 0; i < 10; i++) {
    try {
      const resp = await fetch('http://localhost:9222/json');
      const pages = (await resp.json()) as Array<{
        webSocketDebuggerUrl?: string;
      }>;
      const wsUrl = pages.find(
        (p) => p.webSocketDebuggerUrl,
      )?.webSocketDebuggerUrl;
      if (wsUrl) return wsUrl;
    } catch {}
    await sleep(1000);
  }
  return null;
}

async function cdpEvaluate(
  ws: WebSocket,
  expression: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 100000);
    const msg = JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    });
    const handler = (event: MessageEvent) => {
      const data = JSON.parse(event.data as string);
      if (data.id === id) {
        ws.removeEventListener('message', handler);
        if (data.error) reject(new Error(data.error.message));
        else if (data.result?.exceptionDetails)
          reject(new Error(data.result.exceptionDetails.text));
        else resolve(data.result?.result?.value);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(msg);
    setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error('timeout'));
    }, 10000);
  });
}

async function _cdpNavigate(ws: WebSocket, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 100000);
    const msg = JSON.stringify({
      id,
      method: 'Page.navigate',
      params: { url },
    });
    const handler = (event: MessageEvent) => {
      const data = JSON.parse(event.data as string);
      if (data.id === id) {
        ws.removeEventListener('message', handler);
        if (data.error) reject(new Error(data.error.message));
        else resolve();
      }
    };
    ws.addEventListener('message', handler);
    ws.send(msg);
    setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error('timeout'));
    }, 10000);
  });
}

async function runDiags(ws: WebSocket) {
  log('diag', 'running diagnostics...');

  const userAgent = (await cdpEvaluate(ws, 'navigator.userAgent')) as string;
  log('diag', `UA: ${userAgent.slice(0, 120)}...`);

  const hasGpu = await cdpEvaluate(ws, 'typeof navigator.gpu !== "undefined"');
  log('diag', `navigator.gpu: ${hasGpu ? '✅ present' : '❌ absent'}`);

  if (hasGpu) {
    const adapterInfo = await cdpEvaluate(
      ws,
      `(async () => {
      try {
        const a = await navigator.gpu.requestAdapter();
        if (!a) return JSON.stringify({ ok: false, reason: 'no-adapter' });
        return JSON.stringify({
          ok: true,
          fallback: a.isFallbackAdapter,
          features: [...a.features].join(', '),
          vendor: a.info?.vendor || 'unknown',
          architecture: a.info?.architecture || 'unknown',
        });
      } catch (e) {
        return JSON.stringify({ ok: false, error: String(e) });
      }
    })()`,
    );
    const info = JSON.parse(adapterInfo as string);
    if (info.ok) {
      log(
        'diag',
        `  adapter: ${info.vendor}/${info.architecture} (fallback=${info.fallback}, features: ${info.features})`,
      );
    } else {
      warn('diag', `  adapter request failed: ${info.reason || info.error}`);
    }
  }

  const hwConc = await cdpEvaluate(
    ws,
    'navigator.hardwareConcurrency ?? "N/A"',
  );
  log('diag', `hardwareConcurrency: ${hwConc}`);

  const deviceMem = await cdpEvaluate(
    ws,
    `'deviceMemory' in navigator ? navigator.deviceMemory : 'N/A'`,
  );
  log('diag', `deviceMemory: ${deviceMem}`);

  await sleep(3000);

  const deviceTier = await cdpEvaluate(
    ws,
    `document.documentElement.dataset.deviceTier ?? '(not set)'`,
  );
  log('diag', `deviceTier: ${deviceTier}`);

  const qualityPreset = await cdpEvaluate(
    ws,
    `document.documentElement.dataset.qualityPreset ?? '(not set)'`,
  );
  log('diag', `quality preset: ${qualityPreset}`);

  const canvasInfo = await cdpEvaluate(
    ws,
    `(function() {
    const c = document.querySelector('canvas');
    if (!c) return 'no canvas';
    const info = {};
    if (c.dataset) {
      for (const k of Object.keys(c.dataset)) info[k] = c.dataset[k];
    }
    return JSON.stringify(info);
  })()`,
  );
  log('diag', `canvas datasets: ${canvasInfo}`);

  const fps = await cdpEvaluate(
    ws,
    `(function() {
    return new Promise(resolve => {
      let frames = 0;
      let running = true;
      const id = setInterval(() => { frames = 0; }, 1000);
      function count() { if (!running) return; frames++; requestAnimationFrame(count); }
      requestAnimationFrame(count);
      setTimeout(() => { running = false; clearInterval(id); resolve(frames); }, 2000);
    });
  })()`,
  );
  log('diag', `FPS (2s sample): ${fps}`);

  const liveTelemetry = await cdpEvaluate(
    ws,
    `typeof window.__stims_telemetry !== 'undefined' ? JSON.stringify(window.__stims_telemetry.getLiveStats(), null, 2) : 'N/A'`,
  );
  log('diag', `High-Resolution Telemetry:\n${liveTelemetry}`);
}

async function cleanup(
  server: Awaited<ReturnType<typeof startDevServer>>['server'],
  port: number = DEV_SERVER_PORT,
) {
  await sh('adb', 'reverse', '--remove', `tcp:${port}`).catch(() => {});
  await sh('adb', 'forward', '--remove', 'tcp:9222').catch(() => {});
  try {
    if (server) await server.close();
  } catch {}
}

async function main() {
  const { server, url, port } = await startDevServer();
  let aborted = false;
  process.on('SIGINT', async () => {
    aborted = true;
    await cleanup(server, port);
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    aborted = true;
    await cleanup(server, port);
    process.exit(0);
  });

  try {
    await connectDevice(deviceIp);
    await ensureChromeDebug();
    await setupCdpForward(port);
    await openChrome(url);

    log('cdp', 'connecting to Chrome...');
    const wsUrl = await getPageTarget();
    if (!wsUrl) {
      console.error(
        '[cdp] could not connect to Chrome DevTools. Ensure USB debugging is enabled in Chrome settings.',
      );
      await cleanup(server, port);
      process.exit(1);
    }
    log('cdp', `connected: ${wsUrl}`);

    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('WebSocket connection failed'));
      setTimeout(() => reject(new Error('WebSocket timeout')), 5000);
    });

    await sleep(1000);
    await runDiags(ws);
    ws.close();
  } finally {
    if (!aborted) await cleanup(server, port);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
