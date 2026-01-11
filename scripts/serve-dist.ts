import { stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '../dist');
const port = Number.parseInt(process.env.PORT ?? '8000', 10);
const compressionCache = new Map<
  string,
  { mtime: number; size: number; gzip: Uint8Array }
>();

await ensureBuildExists();

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);

    if (!pathname || pathname === '/') {
      pathname = '/index.html';
    }

    if (pathname.endsWith('/')) {
      pathname += 'index.html';
    }

    const filePath = safeFilePath(pathname);

    if (!filePath) {
      return new Response('Not Found', { status: 404 });
    }

    const file = Bun.file(filePath);

    if (!(await file.exists())) {
      return new Response('Not Found', { status: 404 });
    }

    const headers = new Headers();
    const contentType = file.type || 'application/octet-stream';
    const lastModified = new Date(file.lastModified).toUTCString();
    const etag = makeEtag(file);

    headers.set('Content-Type', contentType);
    headers.set('Cache-Control', cacheControl(pathname));
    headers.set('Last-Modified', lastModified);
    headers.set('ETag', etag);

    const cachedResponse = maybeNotModified(
      request,
      headers,
      etag,
      lastModified,
    );

    if (cachedResponse) {
      return cachedResponse;
    }

    const acceptEncoding = request.headers.get('accept-encoding') ?? '';

    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers });
    }

    if (shouldCompress(contentType) && acceptEncoding.includes('gzip')) {
      const compressed = await gzipCached(filePath, file);

      headers.set('Content-Encoding', 'gzip');
      headers.set('Vary', 'Accept-Encoding');

      // @ts-expect-error: Bun Response supports Uint8Array
      return new Response(compressed, { status: 200, headers });
    }

    return new Response(file, { status: 200, headers });
  },
});

console.log(`Serving dist/ on http://localhost:${server.port}`);

async function ensureBuildExists() {
  try {
    const stats = await stat(distDir);

    if (!stats.isDirectory()) {
      throw new Error();
    }
  } catch (error) {
    console.error(
      "No dist/ directory found. Please run 'bun run build' first.",
      error,
    );
    process.exit(1);
  }
}

function safeFilePath(requestPath: string) {
  const normalized = path.normalize(requestPath).replace(/^\/+/, '');
  const joined = path.join(distDir, normalized);

  if (!joined.startsWith(distDir)) {
    return null;
  }

  return joined;
}

function cacheControl(requestPath: string) {
  if (requestPath.endsWith('.html')) {
    return 'no-store';
  }

  if (/[.-][0-9a-f]{8,}\./i.test(requestPath)) {
    return 'public, max-age=31536000, immutable';
  }

  return 'public, max-age=3600';
}

function shouldCompress(contentType: string) {
  return (
    contentType.startsWith('text/') ||
    contentType.includes('javascript') ||
    contentType.includes('json') ||
    contentType.includes('xml') ||
    contentType === 'image/svg+xml'
  );
}

function makeEtag(file: ReturnType<typeof Bun.file>) {
  const fingerprint = `${file.lastModified}:${file.size}`;
  const hash = Bun.hash(fingerprint).toString(36);

  return `W/"${hash}"`;
}

function maybeNotModified(
  request: Request,
  headers: Headers,
  etag: string,
  lastModified: string,
) {
  const noneMatch = request.headers.get('if-none-match');
  const modifiedSince = request.headers.get('if-modified-since');

  if (noneMatch && noneMatch === etag) {
    return new Response(null, { status: 304, headers });
  }

  if (modifiedSince && modifiedSince === lastModified) {
    return new Response(null, { status: 304, headers });
  }

  return null;
}

async function gzipCached(filePath: string, file: ReturnType<typeof Bun.file>) {
  const cached = compressionCache.get(filePath);

  if (
    cached &&
    cached.mtime === file.lastModified &&
    cached.size === file.size
  ) {
    return cached.gzip;
  }

  const compressed = Bun.gzipSync(new Uint8Array(await file.arrayBuffer()));

  compressionCache.set(filePath, {
    mtime: file.lastModified,
    size: file.size,
    gzip: compressed,
  });

  return compressed;
}
