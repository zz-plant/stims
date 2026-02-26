import process from 'node:process';
import { createServer } from 'vite';

const DEFAULT_PORT = 5173;
const WEBGPU_ARGS = [
  '--enable-unsafe-webgpu',
  '--ignore-gpu-blocklist',
  '--enable-features=Vulkan',
];

async function startServer() {
  const server = await createServer({
    server: {
      host: '127.0.0.1',
      port: DEFAULT_PORT,
      strictPort: true,
    },
  });

  await server.listen();
  return server;
}

async function openChromium(url) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: false,
    args: WEBGPU_ARGS,
  });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const hasWebGPU = await page.evaluate(
    () => typeof navigator.gpu !== 'undefined',
  );
  if (!hasWebGPU) {
    console.warn(
      '[dev:webgpu] navigator.gpu is still unavailable. Verify your GPU drivers and browser WebGPU settings.',
    );
  }

  return browser;
}

const server = await startServer();
const address =
  server.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${DEFAULT_PORT}/`;

console.log(`[dev:webgpu] Dev server ready at ${address}`);

let browser;
try {
  browser = await openChromium(address);
  await new Promise((resolve) => browser.on('disconnected', resolve));
} catch (error) {
  console.error(
    '[dev:webgpu] Unable to open Chromium with WebGPU flags.',
    error,
  );
  console.error(
    `[dev:webgpu] Fallback: run \`bun run dev\` and launch your browser with flags: ${WEBGPU_ARGS.join(' ')}`,
  );
} finally {
  await browser?.close().catch(() => {});
  await server.close();
  process.exit(0);
}
