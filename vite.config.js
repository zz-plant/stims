import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { transform } from 'esbuild';
import { defineConfig } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const toysDataPath = path.resolve(rootDir, 'src/data/toys.json');
const toysData = fs.existsSync(toysDataPath)
  ? JSON.parse(fs.readFileSync(toysDataPath, 'utf8'))
  : [];
const toyEntries = Array.isArray(toysData) ? toysData : [];

const htmlInputs = {
  index: path.resolve(rootDir, 'index.html'),
  milkdrop: path.resolve(rootDir, 'milkdrop/index.html'),
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
      const source = fs.readFileSync(filePath, 'utf8');
      const result = await transform(source, {
        loader: 'ts',
        target: 'es2022',
        format: 'esm',
      });
      return `export default ${JSON.stringify(result.code)}`;
    },
  };
}

export default defineConfig({
  plugins: [react(), audioWorkletTransform()],
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
    rollupOptions: {
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
            if (id.includes('/meyda/')) return 'vendor-meyda';
            if (id.includes('/comlink/')) return 'vendor-comlink';
            if (id.includes('/stats-gl/')) return 'vendor-stats-gl';
            return 'vendor-other';
          }
          return null;
        },
      },
    },
  },
});
