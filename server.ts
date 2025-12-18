import { normalize, join, extname } from "node:path";
import { stat } from "node:fs/promises";

const distRoot = join(import.meta.dir, "dist");
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 4173);

const longCache = "public, max-age=31536000, immutable";
const noCache = "no-cache, no-store, must-revalidate";

async function fileExists(filePath: string) {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

async function resolvePath(pathname: string) {
  const normalized = normalize(pathname).replace(/^\/+/, "");
  const target = normalized || "index.html";
  const withSlashIndex = target.endsWith("/") ? `${target}index.html` : target;
  const candidate = join(distRoot, withSlashIndex);

  if (!candidate.startsWith(distRoot)) return null;

  if (await fileExists(candidate)) return candidate;

  if (!extname(withSlashIndex)) {
    const htmlCandidate = `${withSlashIndex}.html`;
    const htmlPath = join(distRoot, htmlCandidate);
    if (!htmlPath.startsWith(distRoot)) return null;
    if (await fileExists(htmlPath)) return htmlPath;
  }

  return null;
}

function cacheHeader(filePath: string) {
  const type = Bun.mimeType(filePath) ?? "application/octet-stream";
  return type.startsWith("text/html") ? noCache : longCache;
}

async function serveFile(filePath: string) {
  const headers = new Headers();
  headers.set("Content-Type", Bun.mimeType(filePath) ?? "application/octet-stream");
  headers.set("Cache-Control", cacheHeader(filePath));
  return new Response(Bun.file(filePath), { headers });
}

const server = Bun.serve({
  hostname: host,
  port,
  compression: true,
  async fetch(request) {
    const url = new URL(request.url);
    const resolved = await resolvePath(decodeURIComponent(url.pathname));

    if (resolved) {
      return serveFile(resolved);
    }

    const fallback = join(distRoot, "index.html");
    if (await fileExists(fallback)) {
      return serveFile(fallback);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Serving dist/ at http://${host}:${server.port}`);
