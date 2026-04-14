import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initAgentAPI } from './core/agent-api.ts';
import { installRendererTelemetryPersistence } from './core/renderer-telemetry.ts';
import { StimsWorkspaceRouterProvider } from './frontend/workspace-router.tsx';
import { isSmartTvDevice } from './utils/device-detect.ts';
import { initGamepadNavigation } from './utils/gamepad-navigation.ts';

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
  installRendererTelemetryPersistence();
  initAgentAPI();
  initGamepadNavigation();

  if (document.body) {
    document.body.dataset.page = 'workspace';
    document.body.classList.toggle('tv-mode', isSmartTvDevice());
  }

  const container = ensureRootContainer();
  createRoot(container).render(
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

(
  globalThis as typeof globalThis & { __stimsAppReady?: Promise<void> }
).__stimsAppReady = appReady;
