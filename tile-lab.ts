// Tile Lab — experiment: run N real MilkDrop engine instances at micro
// resolution (one WebGL context per tile) and measure compile cost and
// per-frame cost. Prototype only; not wired into the app shell.

import { Scene, WebGLRenderer } from 'three';
import { initCamera } from './src/js/core/camera-setup.ts';
import {
  createMilkdropPostprocessingComposer,
  type PostprocessingPipeline,
  shouldRenderMilkdropPostprocessing,
} from './src/js/core/postprocessing.ts';
import { compileMilkdropPresetSource } from './src/js/milkdrop/compiler.ts';
import { createMilkdropRendererAdapter } from './src/js/milkdrop/renderer-adapter-factory.ts';
import type { MilkdropRendererAdapter } from './src/js/milkdrop/renderer-types.ts';
import { createMilkdropSignalTracker } from './src/js/milkdrop/runtime-signals.ts';
import type { MilkdropRuntimeSignals } from './src/js/milkdrop/types.ts';
import { createMilkdropVM } from './src/js/milkdrop/vm.ts';

const params = new URLSearchParams(location.search);
const TILE_SIZE = Number(params.get('size') ?? 128);
const TILE_COUNT = Number(params.get('tiles') ?? 9);
const DETAIL_SCALE = Number(params.get('detail') ?? 0.25);
const SPECTRUM_BINS = 128;

type Tile = {
  id: string;
  vm: ReturnType<typeof createMilkdropVM>;
  adapter: MilkdropRendererAdapter;
  renderer: WebGLRenderer;
  scene: Scene;
  camera: ReturnType<typeof initCamera>;
  tracker: ReturnType<typeof createMilkdropSignalTracker>;
  post: PostprocessingPipeline | null;
  lastPresented: boolean;
  lastShaderEnabled: boolean;
  statEl: HTMLElement;
  compileMs: number;
  adapterMs: number;
  frameMsAvg: number;
  vmMsAvg: number;
  renderMsAvg: number;
  frames: number;
  failed: string | null;
};

const hud = document.getElementById('hud') as HTMLElement;
const grid = document.getElementById('grid') as HTMLElement;

// Shared synthetic audio: 2 Hz beat pulse, bass-weighted spectrum (same
// shape the reactivity probe uses) so every tile dances to one clock.
const frequencyData = new Uint8Array(SPECTRUM_BINS);
const waveformData = new Uint8Array(SPECTRUM_BINS);
function fillAudioFrame(timeMs: number) {
  const beat = Math.sin((2 * Math.PI * timeMs) / 500) ** 2;
  for (let i = 0; i < frequencyData.length; i += 1) {
    frequencyData[i] = Math.round(
      (0.35 + 0.65 * beat) * 255 * Math.exp(-i / 48),
    );
  }
  for (let i = 0; i < waveformData.length; i += 1) {
    waveformData[i] =
      128 + Math.round(100 * beat * Math.sin(i * 0.35 + timeMs * 0.02));
  }
}

async function loadCatalogPresets(): Promise<{ id: string; file: string }[]> {
  const res = await fetch('/milkdrop-presets/catalog.json');
  const catalog = (await res.json()) as {
    presets: { id: string; file: string; supports?: { webgl?: boolean } }[];
  };
  const offset = Number(params.get('offset') ?? 0);
  return catalog.presets
    .filter((p) => p.supports?.webgl !== false)
    .slice(offset, offset + TILE_COUNT)
    .map((p) => ({ id: p.id, file: p.file }));
}

async function createTile(entry: {
  id: string;
  file: string;
}): Promise<Tile | null> {
  const wrap = document.createElement('div');
  wrap.className = 'tile';
  const canvas = document.createElement('canvas');
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = entry.id;
  const statEl = document.createElement('div');
  statEl.className = 'stat';
  statEl.textContent = 'compiling…';
  wrap.append(canvas, label, statEl);
  grid.append(wrap);

  try {
    const raw = await (await fetch(entry.file)).text();
    const t0 = performance.now();
    const compiled = compileMilkdropPresetSource(raw, { id: entry.id });
    const compileMs = performance.now() - t0;

    const renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'low-power',
    });
    renderer.setSize(TILE_SIZE, TILE_SIZE, false);
    renderer.setPixelRatio(1);
    const scene = new Scene();
    const camera = initCamera({ aspect: 1 });

    const t1 = performance.now();
    const adapter = createMilkdropRendererAdapter({
      scene,
      camera,
      renderer,
      backend: 'webgl',
      preset: compiled,
      fallbackCustomWaves: true,
    });
    adapter.attach();
    const adapterMs = performance.now() - t1;

    const vm = createMilkdropVM(compiled);
    vm.setRenderBackend('webgl');
    // Keep mesh/particle work proportional to the tiny viewport.
    vm.setDetailScale(DETAIL_SCALE);

    return {
      id: entry.id,
      vm,
      adapter,
      renderer,
      scene,
      camera,
      tracker: createMilkdropSignalTracker(),
      post: null,
      lastPresented: false,
      lastShaderEnabled: false,
      statEl,
      compileMs,
      adapterMs,
      frameMsAvg: 0,
      vmMsAvg: 0,
      renderMsAvg: 0,
      frames: 0,
      failed: null,
    };
  } catch (error) {
    statEl.textContent = `failed: ${String(error).slice(0, 60)}`;
    return null;
  }
}

async function main() {
  const bootStart = performance.now();
  const entries = await loadCatalogPresets();
  const tiles: Tile[] = [];
  // Sequential creation on purpose: measures the compile/attach hitch a
  // scroll would cause one tile at a time.
  for (const entry of entries) {
    const tile = await createTile(entry);
    if (tile) {
      tiles.push(tile);
    }
  }
  const bootMs = performance.now() - bootStart;

  let frameCount = 0;
  let loopMsAvg = 0;
  let lastTickAt = performance.now();
  let rafSeen = false;

  const tick = () => {
    const tickStart = performance.now();
    const deltaMs = Math.min(100, tickStart - lastTickAt);
    lastTickAt = tickStart;
    const timeMs = tickStart;
    fillAudioFrame(timeMs);

    for (const tile of tiles) {
      if (tile.failed) {
        continue;
      }
      const t0 = performance.now();
      try {
        const baseSignals = tile.tracker.update({
          time: timeMs / 1000,
          deltaMs,
          analyser: null,
          frequencyData,
          waveformData,
        });
        const signals = baseSignals as MilkdropRuntimeSignals;
        signals.aspect = 1;
        signals.pixelsx = TILE_SIZE;
        signals.pixelsy = TILE_SIZE;
        const frameState = tile.vm.step(signals);
        const tVm = performance.now();
        const presented = tile.adapter.render({ frameState, blendState: null });
        tile.lastPresented = Boolean(presented);
        tile.lastShaderEnabled = Boolean(frameState.post.shaderEnabled);
        if (!presented) {
          // Mirror the real frame loop: non-shader presets get their echo /
          // trail emulation from the postprocessing composer.
          const profile = frameState.post.postprocessingProfile ?? null;
          if (
            profile &&
            shouldRenderMilkdropPostprocessing({
              backend: 'webgl',
              renderer: tile.renderer,
              profile,
            })
          ) {
            if (tile.post) {
              tile.post.applyProfile(profile);
            } else {
              tile.post = createMilkdropPostprocessingComposer({
                renderer: tile.renderer,
                scene: tile.scene,
                camera: tile.camera,
                profile,
              });
            }
            if (tile.post) {
              tile.post.updateSize();
              tile.post.render();
            } else {
              tile.renderer.render(tile.scene, tile.camera);
            }
          } else {
            tile.renderer.render(tile.scene, tile.camera);
          }
        }
        const ms = performance.now() - t0;
        tile.vmMsAvg = tile.vmMsAvg * 0.95 + (tVm - t0) * 0.05;
        tile.renderMsAvg =
          tile.renderMsAvg * 0.95 + (performance.now() - tVm) * 0.05;
        tile.frameMsAvg = tile.frameMsAvg * 0.95 + ms * 0.05;
        tile.frames += 1;
      } catch (error) {
        tile.failed = String(error).slice(0, 80);
        tile.statEl.textContent = `frame failed: ${tile.failed}`;
      }
    }

    const loopMs = performance.now() - tickStart;
    loopMsAvg = loopMsAvg * 0.95 + loopMs * 0.05;
    frameCount += 1;

    if (frameCount % 30 === 0) {
      for (const tile of tiles) {
        if (!tile.failed) {
          tile.statEl.textContent = `${tile.frameMsAvg.toFixed(2)}ms/f · compile ${tile.compileMs.toFixed(0)}ms · attach ${tile.adapterMs.toFixed(0)}ms`;
        }
      }
      hud.textContent =
        `tiles: ${tiles.length}/${entries.length} live · boot ${bootMs.toFixed(0)}ms total\n` +
        `loop: ${loopMsAvg.toFixed(2)}ms per tick for all tiles ` +
        `(${(loopMsAvg / Math.max(1, tiles.length)).toFixed(2)}ms/tile) · ` +
        `${frameCount} frames · driver: ${rafSeen ? 'rAF' : 'interval'}`;
      publishMetrics(tiles, bootMs, loopMsAvg, frameCount);
    }
  };

  // Browser-pane tabs can report document.hidden=true; fall back to a
  // timer if rAF never fires so the experiment still runs there.
  const rafLoop = () => {
    rafSeen = true;
    tick();
    requestAnimationFrame(rafLoop);
  };
  requestAnimationFrame(rafLoop);
  setTimeout(() => {
    if (!rafSeen) {
      setInterval(tick, 33);
    }
  }, 700);

  // Manual driver for headless/hidden-tab measurement: runs n frames in a
  // tight loop and returns wall-clock stats.
  (
    window as unknown as { __tileLabStep: (n: number) => unknown }
  ).__tileLabStep = (n: number) => {
    const start = performance.now();
    for (let i = 0; i < n; i += 1) {
      tick();
    }
    const totalMs = performance.now() - start;
    publishMetrics(tiles, bootMs, loopMsAvg, frameCount);
    return {
      framesRun: n,
      totalMs,
      msPerFrameAllTiles: totalMs / n,
      tiles: tiles.length,
    };
  };
}

function publishMetrics(
  tiles: Tile[],
  bootMs: number,
  loopMsAvg: number,
  frameCount: number,
) {
  (window as unknown as { __tileLab: unknown }).__tileLab = {
    bootMs,
    loopMsAvg,
    frameCount,
    tiles: tiles.map((tile) => ({
      id: tile.id,
      compileMs: tile.compileMs,
      adapterMs: tile.adapterMs,
      vmMsAvg: tile.vmMsAvg,
      renderMsAvg: tile.renderMsAvg,
      presented: tile.lastPresented,
      shaderEnabled: tile.lastShaderEnabled,
      hasPost: tile.post !== null,
      frameMsAvg: tile.frameMsAvg,
      frames: tile.frames,
      failed: tile.failed,
    })),
  };
}

main().catch((error) => {
  hud.textContent = `boot failed: ${error}`;
});
