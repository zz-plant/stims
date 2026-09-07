import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build } from 'esbuild';
import { defineConfig } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const toysDataPath = path.resolve(rootDir, 'src/data/toys.json');
const toysData = fs.existsSync(toysDataPath)
  ? JSON.parse(fs.readFileSync(toysDataPath, 'utf8'))
  : [];
const toyEntries = Array.isArray(toysData) ? toysData : [];

// milkdrop/index.html is a pure redirect (no JS imports) — exclude it from
// Vite bundling to avoid an unnecessary chunk graph.  It is copied to dist/
// as a static asset by Vite's default public-dir behaviour.
const htmlInputs = {
  index: path.resolve(rootDir, 'index.html'),
  certify: path.resolve(rootDir, 'certify/index.html'),
  performance: path.resolve(rootDir, 'performance/index.html'),
};
const moduleInputs = Object.fromEntries(
  toyEntries
    .filter((toy) => toy.type === 'module')
    .map((toy) => [toy.module, path.resolve(rootDir, toy.module)]),
);
const rollupInputs = {
  ...htmlInputs,
  ...moduleInputs,
};

if (!rollupInputs.index) {
  rollupInputs.index = path.resolve(rootDir, 'index.html');
}

function audioWorkletTransform() {
  return {
    name: 'audio-worklet-transform',
    enforce: 'pre',
    async load(id) {
      const match = id.match(/^(.+?\.ts)\?worklet/);
      if (!match) return null;
      const filePath = match[1];
      // Bundle (not just transform) so the worklet can import shared DSP
      // modules like harmonic-percussive.ts. Bundle output for a single
      // import-free file is identical to the old transform; for files with
      // imports it inlines them, which keeps the AudioWorkletGlobalScope
      // import-free.
      const result = await build({
        entryPoints: [filePath],
        bundle: true,
        write: false,
        format: 'esm',
        target: 'es2022',
        logLevel: 'silent',
      });
      return `export default ${JSON.stringify(result.outputFiles[0].text)}`;
    },
  };
}

// Preset previews are published to R2 (scripts/sync-previews-r2.ts) and
// served from there in production; the default public-dir copy only bloats
// local dist (~270MB of images) and slows local deploys. CI never has them
// (the directory is gitignored), so pruning makes local builds match CI.
// Local `vite preview` will 404 preview images — PresetArtwork falls back.
// App.tsx statically imports the full app-shell/chrome CSS (every panel's
// styles, ~130KB+51KB minified) so Vite bundles it into one graph-wide
// stylesheet and auto-injects it as a plain blocking `<link rel="stylesheet"
// crossorigin>` — render-blocking on every visit, including the bare launch
// screen, which only needs a sliver of it. The hand-authored stylesheets in
// index.html already avoid this via the media="print"/onload swap trick;
// this extends the same treatment to Vite's own output so both follow one
// convention instead of one being deferred and the other not. Scoped to the
// main app entry only (crossorigin is the marker Vite's own injected links
// carry that the hand-authored ones don't) — certify/performance are plain
// content pages with no splash-covered boot sequence to protect.
function deferAppShellStylesheets() {
  return {
    name: 'defer-app-shell-stylesheets',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (ctx.path !== '/index.html') {
          return html;
        }
        return html.replace(
          /<link rel="stylesheet" crossorigin href="([^"]+)">/g,
          (_match, href) =>
            `<link rel="stylesheet" crossorigin href="${href}" media="print" onload="this.media='all'">` +
            `<noscript><link rel="stylesheet" crossorigin href="${href}" /></noscript>`,
        );
      },
    },
  };
}

function prunePreviewsFromDist() {
  return {
    name: 'prune-previews-from-dist',
    apply: 'build',
    closeBundle() {
      fs.rmSync(path.resolve(rootDir, 'dist/milkdrop-presets/previews'), {
        recursive: true,
        force: true,
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    audioWorkletTransform(),
    deferAppShellStylesheets(),
    prunePreviewsFromDist(),
  ],
  resolve: {
    dedupe: ['react', 'react-dom', 'three'],
  },
  server: {
    // Bind to all interfaces so forwarded browsers (e.g., Playwright) can reach
    // the dev server instead of seeing connection refused.
    host: true,
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    minify: true,
    cssMinify: true,
    // The WebGPU renderer bundle is intentionally large and loaded on demand.
    // Chunks are split into vendor-react, vendor-three, and vendor-codemirror.
    chunkSizeWarningLimit: 400,
    // Emit the standard .vite/manifest.json so docs and tooling resolve assets
    // without custom paths.
    manifest: true,
    rolldownOptions: {
      // Keep the visualizer entry exports intact so dynamic imports from the homepage
      // can find the `start` functions even when they look unused at build time.
      preserveEntrySignatures: 'strict',
      input: rollupInputs,
      output: {
        // Content hashes alone provide cache busting. Do NOT add a build
        // timestamp here: it renames every chunk on every deploy, so returning
        // users re-download ~1.7 MB of byte-identical vendor code.
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        // Vite 8 deprecates the function form of manualChunks in favour of
        // Rolldown's codeSplitting groups, but the two are not equivalent for
        // this graph and the difference is measurable (see
        // docs/TECH_STACK_MODERNIZATION_2026-09.md): groups with recursive
        // dependency capture move ~250 kB of three's core into
        // vendor-three-webgpu, and turning capture off forces
        // preserveEntrySignatures off, which lets the entry absorb shared
        // modules and doubles the eager index chunk. The function form still
        // reproduces the intended split byte-for-byte, so it stays until
        // Rolldown offers a non-recursive group mode under 'strict'.
        manualChunks: (id) => {
          if (id.includes('/node_modules/')) {
            if (
              id.includes('/three/webgpu') ||
              id.includes('/three/tsl') ||
              id.includes('three.webgpu')
            )
              return 'vendor-three-webgpu';
            if (id.includes('/three/')) return 'vendor-three';
            if (id.includes('/@codemirror/')) return 'vendor-codemirror';
            if (id.includes('/react-dom/') || id.includes('/react/'))
              return 'vendor-react';
            // Runtime-only vendors: reachable only from the dynamically
            // imported renderer/audio/editor chain, so keep them out of the
            // eagerly-fetched vendor-other chunk that the entry graph pulls.
            if (id.includes('/comlink/')) return 'vendor-comlink';
            // The Strudel live-coding stack is behind ?strudel=1 and its
            // bridge lazy-imports @strudel/web — but without this carve-out
            // its whole dependency tree (core/tonal/superdough/…) landed in
            // vendor-other, which the entry graph fetches eagerly, taxing
            // every visitor's boot for a lab almost none of them open.
            if (id.includes('/@strudel/') || id.includes('/superdough'))
              return 'vendor-strudel';
            return 'vendor-other';
          }
          return null;
        },
      },
    },
  },
});
