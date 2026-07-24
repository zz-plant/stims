import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
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

const buildId = `v3-${Date.now().toString(36)}`;

export default defineConfig({
  plugins: [react()],
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
    target: 'es2020',
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
        entryFileNames: `assets/[name]-${buildId}-[hash].js`,
        chunkFileNames: `assets/[name]-${buildId}-[hash].js`,
        assetFileNames: `assets/[name]-${buildId}-[hash].[ext]`,
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('three/webgpu') || id.includes('three.webgpu'))
              return 'vendor-three-webgpu';
            if (id.includes('three')) return 'vendor-three';
            if (id.includes('@codemirror/')) return 'vendor-codemirror';
            if (id.includes('react') || id.includes('react-dom'))
              return 'vendor-react';
            return 'vendor-other';
          }
          return null;
        },
      },
    },
  },
});
