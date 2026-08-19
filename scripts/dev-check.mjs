/**
 * Smoke-tests the Vite dev server by booting it and fetching the app once.
 *
 * Starts Vite on 127.0.0.1:5173 with HMR and dep pre-bundling off, requests the
 * resolved URL, then always shuts the server down; a non-OK response exits
 * non-zero so a broken dev boot fails the quality gate.
 */
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
  console.error(error);
  process.exitCode = 1;
});
