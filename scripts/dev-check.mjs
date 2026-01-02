/* eslint-env node */
/* global fetch, console, process */
import { createServer } from 'vite';

async function main() {
  const server = await createServer({
    clearScreen: false,
    logLevel: 'error',
    optimizeDeps: {
      disabled: true,
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      hmr: false,
    },
  });

  const started = await server.listen();
  const url = started.resolvedUrls?.local?.[0] ?? 'http://127.0.0.1:5173/';

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Dev server responded with status ${response.status}`);
    }
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
