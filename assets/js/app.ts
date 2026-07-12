import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initAgentAPI } from './core/agent-api.ts';
import { applyDeviceTierToDocument } from './core/device-profile.ts';
import { installRendererTelemetryPersistence } from './core/renderer-telemetry.ts';
import { reportLoadStatus } from './frontend/load-status.ts';
import { StimsWorkspaceRouterProvider } from './frontend/workspace-router.tsx';
import { isSmartTvDevice } from './utils/device-detect.ts';
import { initGamepadNavigation } from './utils/gamepad-navigation.ts';

type StimsAppGlobals = typeof globalThis & {
  __stimsAppDispose?: () => void;
  __stimsAppReady?: Promise<void>;
};

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
  installRendererTelemetryPersistence();
  initAgentAPI();
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
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js');
  });
}

window.addEventListener('pagehide', () => {
  void import('./core/audio-handler.ts').then(({ stopAllAudioForBfcache }) => {
    stopAllAudioForBfcache();
  });
});
