import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, "../dist");
const port = Number.parseInt(process.env.PORT ?? "8000", 10);

await ensureBuildExists();

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);

    if (!pathname || pathname === "/") {
      pathname = "/index.html";
    }

    if (pathname.endsWith("/")) {
      pathname += "index.html";
    }

    const filePath = safeFilePath(pathname);

    if (!filePath) {
      return new Response("Not Found", { status: 404 });
    }

    const file = Bun.file(filePath);

    if (!(await file.exists())) {
      return new Response("Not Found", { status: 404 });
    }

    const headers = new Headers();
    const contentType = file.type || "application/octet-stream";
    headers.set("Content-Type", contentType);
    headers.set("Cache-Control", cacheControl(pathname));

    const acceptEncoding = request.headers.get("accept-encoding") ?? "";

    if (shouldCompress(contentType) && acceptEncoding.includes("gzip")) {
      headers.set("Content-Encoding", "gzip");
      headers.set("Vary", "Accept-Encoding");

      const compressed = Bun.gzipSync(new Uint8Array(await file.arrayBuffer()));
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
  } catch {
    console.error("No dist/ directory found. Please run 'bun run build' first.");
    process.exit(1);
  }
}

function safeFilePath(requestPath: string) {
  const normalized = path.normalize(requestPath).replace(/^\/+/, "");
  const joined = path.join(distDir, normalized);

  if (!joined.startsWith(distDir)) {
    return null;
  }

  return joined;
}

function cacheControl(requestPath: string) {
  if (requestPath.endsWith(".html")) {
    return "no-store";
  }

  if (/[.-][0-9a-f]{8,}\./i.test(requestPath)) {
    return "public, max-age=31536000, immutable";
  }

  return "public, max-age=3600";
}

function shouldCompress(contentType: string) {
  return (
    contentType.startsWith("text/") ||
    contentType.includes("javascript") ||
    contentType.includes("json") ||
    contentType.includes("xml") ||
    contentType === "image/svg+xml"
  );
}
