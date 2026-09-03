// React seam for the live tile pool: catalog tiles render the actual preset,
// animated, when the `?liveTiles` prototype flag is set (same flag style as
// `?strudel`, see workspace-ui.tsx). Falls back to static artwork otherwise.
//
// The pool module pulls in the full imperative engine (compiler, renderer
// adapter, VM), so it is imported dynamically on first use — a static import
// here would drag the engine into the initial React graph and stall first
// paint.

import { useEffect, useRef } from 'react';
import { isAgentMode, parseURLParams } from '../../core/url-params.ts';
import type {
  MilkdropLiveTileHandle,
  MilkdropLiveTilePool,
} from '../../milkdrop/live-tile-pool.ts';
import type { PresetCatalogEntry } from '../contracts.ts';
import { getAudioEnergy } from '../engine-audio-energy-store.ts';
import { getLiveTileCapacity } from '../engine-quality-store.ts';
import {
  markPresetUnrenderable,
  rememberPresetStill,
} from '../preset-still-capture.ts';

export const livePresetTilesEnabled = parseURLParams().flags.liveTiles;

// Agent-mode QA runs in panes where document.hidden stays true and rAF never
// fires (see the browser-pane telemetry-bridge notes); a timer scheduler
// keeps tiles stepping there. Production keeps rAF so background tabs pause.
const agentModeScheduler = isAgentMode();

export const MAX_PRESET_FILE_CACHE_SIZE = 500;
const presetFileById = new Map<string, string>();

export function setPresetFile(id: string, file: string) {
  if (presetFileById.has(id)) {
    presetFileById.delete(id);
  } else if (presetFileById.size >= MAX_PRESET_FILE_CACHE_SIZE) {
    const oldestKey = presetFileById.keys().next().value;
    if (oldestKey !== undefined) {
      presetFileById.delete(oldestKey);
    }
  }
  presetFileById.set(id, file);
}

export function getPresetFileCacheSize(): number {
  return presetFileById.size;
}

let poolPromise: Promise<MilkdropLiveTilePool> | null = null;

function ensurePool(): Promise<MilkdropLiveTilePool> {
  poolPromise ??= import('../../milkdrop/live-tile-pool.ts').then(
    ({ createMilkdropLiveTilePool }) =>
      createMilkdropLiveTilePool({
        loadPresetRaw: async (presetId) => {
          const file = presetFileById.get(presetId);
          if (!file) {
            return null;
          }
          const response = await fetch(file);
          return response.ok ? response.text() : null;
        },
        // The engine snapshot's audio energy scalar shapes the synthetic
        // pulse so tiles follow the room even before raw analyser data is
        // exposed to this side of the engine seam.
        energyProvider: () => 0.35 + getAudioEnergy() * 0.9,
        // Shrink the preview pool while the stage's adaptive quality is
        // degrading, so browse-grid decoration stops competing with the
        // renderer the user is actually watching.
        capacityProvider: getLiveTileCapacity,
        ...(agentModeScheduler
          ? {
              scheduleFrame: (cb: () => void) =>
                window.setTimeout(cb, 33) as unknown as number,
              cancelFrame: (handle: number) => window.clearTimeout(handle),
            }
          : {}),
      }),
  );
  if (agentModeScheduler) {
    // Agent-mode QA introspection (same spirit as the agent debug snapshot).
    void poolPromise.then((pool) => {
      (
        window as unknown as { __stimsLiveTilePool?: MilkdropLiveTilePool }
      ).__stimsLiveTilePool = pool;
    });
  }
  return poolPromise;
}

export function canRenderLiveTile(entry: PresetCatalogEntry): boolean {
  return livePresetTilesEnabled && typeof entry.file === 'string';
}

/** Whether this entry could host a hover-audition live tile. */
export function canAuditionLiveTile(entry: PresetCatalogEntry): boolean {
  return typeof entry.file === 'string';
}

/**
 * Mounts a live tile canvas for the preset into the returned host element.
 * The canvas is owned by the pool (it survives unmounts for LRU revival), so
 * the hook only ever appends/removes it, never destroys it.
 */
export function useLivePresetTile(
  entry: PresetCatalogEntry,
  options: { audition?: boolean } = {},
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // `audition` activates one tile on demand (grid hover/focus) without the
  // global ?liveTiles flag. Deactivating unmounts the effect, which releases
  // the pool handle — so a single hovered tile is the steady-state cost.
  const enabled =
    canRenderLiveTile(entry) ||
    (options.audition === true && canAuditionLiveTile(entry));

  useEffect(() => {
    if (!enabled || !entry.file) {
      return;
    }
    setPresetFile(entry.id, entry.file);
    let cancelled = false;
    let handle: MilkdropLiveTileHandle | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let readyPoll: number | null = null;
    const host = hostRef.current;
    void ensurePool().then((pool) => {
      if (cancelled) {
        return;
      }
      handle = pool.acquire(entry.id);
      canvas = handle.canvas;
      if (host && canvas.parentElement !== host) {
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.objectFit = 'cover';
        canvas.style.display = 'block';
        host.append(canvas);
      }
      // The canvas element exists (and reports a nonzero size) the instant
      // it's acquired, well before the engine has compiled or painted a
      // frame — a consumer (the promote transition's snapshot) that only
      // checks canvas dimensions can grab a blank frame. Mirror the pool's
      // real status onto the DOM so consumers can gate on it.
      const syncStatus = () => {
        if (!host || !handle) {
          return false;
        }
        const status = handle.getStatus();
        host.dataset.liveTileReady = String(status === 'live');
        // This tile is already rendering the preset for its own reasons, so
        // its canvas holds a true frame of it. Keeping one costs a pixel copy
        // and means the art slot can show something real after the audition
        // ends, instead of the generated picture it used to invent. Booting
        // engines *in order* to capture is the trade this deliberately avoids
        // — see preset-still-capture.ts.
        if (status === 'live') {
          rememberPresetStill(entry.id, handle.canvas);
        } else if (status === 'failed') {
          markPresetUnrenderable(entry.id);
        }
        return status === 'live' || status === 'failed';
      };
      if (!syncStatus()) {
        readyPoll = window.setInterval(() => {
          if (syncStatus() && readyPoll !== null) {
            window.clearInterval(readyPoll);
            readyPoll = null;
          }
        }, 120) as unknown as number;
      }
    });
    return () => {
      cancelled = true;
      if (readyPoll !== null) {
        window.clearInterval(readyPoll);
      }
      handle?.release();
      if (canvas && canvas.parentElement === host) {
        canvas.remove();
      }
    };
  }, [enabled, entry.id, entry.file]);

  return { enabled, hostRef };
}
