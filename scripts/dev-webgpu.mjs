import process from 'node:process';
import { createServer } from 'vite';

const DEFAULT_PORT = 5173;

const WEBGPU_ARGS = [
  '--enable-unsafe-webgpu',
  '--ignore-gpu-blocklist',
  '--enable-features=Vulkan,WebGPU,SharedArrayBuffer',
  '--enable-dawn-features=allow_unsafe_apis',
  '--disable-dawn-features=disallow_unsafe_apis',
  '--use-angle=vulkan',
  '--use-gl=angle',
];

const HEADLESS_ARGS = ['--headless=new', '--disable-gpu-sandbox'];

/**
 * Parse CLI arguments for optional overrides.
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    headless: false,
    port: DEFAULT_PORT,
    host: '127.0.0.1',
  };

  for (const arg of args) {
    if (arg === '--headless') {
      options.headless = true;
    } else if (arg.startsWith('--port=')) {
      const raw = Number.parseInt(arg.slice('--port='.length), 10);
      if (!Number.isNaN(raw) && raw > 0 && raw <= 65535) {
        options.port = raw;
      }
    } else if (arg.startsWith('--host=')) {
      options.host = arg.slice('--host='.length);
    }
  }

  return options;
}

async function startServer({ port, host }) {
  const server = await createServer({
    server: {
      host,
      port,
      strictPort: true,
    },
  });

  await server.listen();
  return server;
}

async function openChromium(url, { headless }) {
  const { chromium } = await import('playwright');

  const launchArgs = [...WEBGPU_ARGS];
  if (headless) {
    launchArgs.push(...HEADLESS_ARGS);
  }

  const browser = await chromium.launch({
    headless: !!headless,
    args: launchArgs,
  });

  const page = await browser.newPage();

  // Suppress noisy console messages from GPU/WebGPU internals
  page.on('pageerror', (error) => {
    console.warn(`[dev:webgpu] Page error: ${error.message}`);
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Comprehensive WebGPU availability check
  const webgpuStatus = await page.evaluate(() => {
    const hasNavigatorGpu = typeof navigator.gpu !== 'undefined';
    const hasRequestAdapter =
      hasNavigatorGpu && typeof navigator.gpu?.requestAdapter === 'function';
    const hasGetPreferredCanvasFormat =
      hasNavigatorGpu &&
      typeof navigator.gpu?.getPreferredCanvasFormat === 'function';

    return {
      hasNavigatorGpu,
      hasRequestAdapter,
      hasGetPreferredCanvasFormat,
      userAgent: navigator.userAgent,
    };
  });

  // Report status
  if (!webgpuStatus.hasNavigatorGpu) {
    console.warn(
      '[dev:webgpu] ⚠️  navigator.gpu is not available. WebGPU is not exposed by this browser build.\n' +
        '    Verify your GPU drivers and ensure you are using a WebGPU-capable Chromium build.\n' +
        '    Chrome 113+ or Edge 113+ with the "WebGPU" flag enabled is required.',
    );
  } else if (!webgpuStatus.hasRequestAdapter) {
    console.warn(
      '[dev:webgpu] ⚠️  navigator.gpu exists but requestAdapter is not callable.\n' +
        '    This may indicate a partially-enabled WebGPU build.',
    );
  } else {
    // Attempt to actually request an adapter for full validation
    const adapterResult = await page.evaluate(async () => {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
          return { success: false, reason: 'no-adapter' };
        }
        // Check if it's a fallback (software) adapter
        const isFallback = Boolean(adapter.isFallbackAdapter);
        const features = [...(adapter.features ?? [])];
        const limits = {
          maxTextureDimension2D: adapter.limits?.maxTextureDimension2D,
          maxStorageBufferBindingSize:
            adapter.limits?.maxStorageBufferBindingSize,
          maxComputeInvocationsPerWorkgroup:
            adapter.limits?.maxComputeInvocationsPerWorkgroup,
        };
        return {
          success: true,
          isFallback,
          features,
          limits,
        };
      } catch (error) {
        return {
          success: false,
          reason: 'request-failed',
          error: String(error),
        };
      }
    });

    if (adapterResult.success) {
      console.log(`[dev:webgpu] ✅ WebGPU adapter acquired successfully.`);
      if (adapterResult.isFallback) {
        console.warn(
          '[dev:webgpu] ⚠️  Running on a fallback (software) adapter. Performance may be degraded.',
        );
      }
      console.log(
        `[dev:webgpu]    Features: ${adapterResult.features.join(', ') || '(none)'}`,
      );
      console.log(
        `[dev:webgpu]    Limits: maxTextureDimension2D=${adapterResult.limits.maxTextureDimension2D}, ` +
          `maxStorageBuffer=${adapterResult.limits.maxStorageBufferBindingSize}, ` +
          `maxComputeInvocations=${adapterResult.limits.maxComputeInvocationsPerWorkgroup}`,
      );
    } else {
      console.warn(
        `[dev:webgpu] ⚠️  Unable to acquire WebGPU adapter: ${adapterResult.reason}.` +
          (adapterResult.error ? ` (${adapterResult.error})` : ''),
      );
    }
  }

  return browser;
}

const options = parseArgs();

const server = await startServer({
  port: options.port,
  host: options.host,
});
const address =
  server.resolvedUrls?.local?.[0] ?? `http://${options.host}:${options.port}/`;

console.log(
  `[dev:webgpu] Dev server ready at ${address}` +
    (options.headless ? ' (headless mode)' : ''),
);
console.log(`[dev:webgpu] Browser flags: ${WEBGPU_ARGS.join(' ')}`);

let browser;
try {
  browser = await openChromium(address, { headless: options.headless });
  await new Promise((resolve) => browser.on('disconnected', resolve));
} catch (error) {
  console.error(
    '[dev:webgpu] Unable to open Chromium with WebGPU flags.',
    error,
  );
  console.error(
    `[dev:webgpu] Fallback: run \`bun run dev\` and launch your browser with flags:\n` +
      `  ${WEBGPU_ARGS.join(' ')}`,
  );
} finally {
  await browser?.close().catch(() => {});
  await server.close();
  process.exit(0);
}
