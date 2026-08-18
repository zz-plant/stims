import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initAgentAPI } from './core/agent-api.ts';
import { installAgentDriver } from './core/agent-driver.ts';
import {
  applyDeviceTierToDocument,
  startRefreshRateSampling,
} from './core/device-profile.ts';
import { startBatteryMonitoring } from './core/power-state.ts';
import { installRendererTelemetryPersistence } from './core/renderer-telemetry.ts';
import { installCrashTelemetry } from './core/services/crash-telemetry.ts';
import { reportLoadStatus } from './frontend/load-status.ts';
import { StimsWorkspaceRouterProvider } from './frontend/workspace-router.tsx';
import { isSmartTvDevice } from './utils/browser/device-detect.ts';
import { initGamepadNavigation } from './utils/browser/gamepad-navigation.ts';

type StimsAppGlobals = typeof globalThis & {
  __stimsAppDispose?: () => void;
  __stimsAppReady?: Promise<void>;
  __stimsStarterCatalogPromise?: Promise<unknown>;
};

/**
 * Kick off the starter catalog fetch immediately, before React mounts.
 * The renderer capability probe and battery/refresh-rate sampling also start
 * here, so this fetch runs in parallel with all of them instead of waiting
 * for React hydration + useCatalogLoading to fire.
 */
const STARTER_CATALOG_URL = '/milkdrop-presets/starter-catalog.json';
(globalThis as StimsAppGlobals).__stimsStarterCatalogPromise = fetch(
  STARTER_CATALOG_URL,
)
  .then((r) => {
    if (!r.ok) throw new Error(`Starter catalog fetch failed (${r.status})`);
    return r.json();
  })
  .catch(() => null);

function ensureRootContainer() {
  const existing = document.getElementById('app');
  if (existing instanceof HTMLElement) {
    return existing;
  }

  const root = document.createElement('div');
  root.id = 'app';
  document.body.replaceChildren(root);
  return root;
}

const startApp = async () => {
  reportLoadStatus('app-module');
  // Start early: the adaptive quality controller reads the refresh rate when it
  // is constructed, and an unmeasured rate falls back to a conservative 60.
  startRefreshRateSampling();
  // Also start early: renderer setup waits on this to choose between the
  // discrete and integrated GPU, and that wait is only cheap if the probe is
  // already in flight by the time the capability probe runs.
  void startBatteryMonitoring();
  installCrashTelemetry();
  installRendererTelemetryPersistence();
  initAgentAPI();
  installAgentDriver();
  initGamepadNavigation();

  if (document.body) {
    document.body.dataset.page = 'workspace';
    document.body.classList.toggle('tv-mode', isSmartTvDevice());
    applyDeviceTierToDocument();
  }

  const container = ensureRootContainer();
  const root = createRoot(container);
  (globalThis as StimsAppGlobals).__stimsAppDispose = () => {
    root.unmount();
    delete (globalThis as StimsAppGlobals).__stimsAppDispose;
  };
  root.render(
    createElement(
      StrictMode,
      null,
      createElement(StimsWorkspaceRouterProvider, null),
    ),
  );
};

let appStarted = false;

const appReady = new Promise<void>((resolve) => {
  const startAppOnce = () => {
    if (appStarted) {
      resolve();
      return;
    }
    appStarted = true;
    void startApp().finally(resolve);
  };

  if (document.readyState === 'loading' && !document.body) {
    document.addEventListener('DOMContentLoaded', startAppOnce, { once: true });
  } else {
    startAppOnce();
  }
});

(globalThis as StimsAppGlobals).__stimsAppReady = appReady;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').then((reg) => {
    void reg.update();
  });
}

window.addEventListener('pagehide', () => {
  void import('./core/audio-handler.ts').then(({ stopAllAudioForBfcache }) => {
    stopAllAudioForBfcache();
  });
  void import('./core/services/render-service.ts')
    .then(({ resetRendererPool }) => {
      resetRendererPool({ dispose: true });
    })
    .catch(() => {});
});
