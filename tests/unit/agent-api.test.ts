import { expect, test } from 'bun:test';
import {
  clearDebugSnapshot,
  initAgentAPI,
  setAudioActive,
  setCurrentToy,
  setDebugSnapshot,
} from '../../src/js/core/agent-api.ts';
import { registerEscapeHandler } from '../../src/js/core/modal-utils.ts';

test('activateVibeMode toggles state and root dataset', async () => {
  const api = initAgentAPI();
  const activatePromise = api.activateVibeMode(600);

  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(api.getState().vibeMode).toBe(true);
  expect(document.documentElement.dataset.agentVibeMode).toBe('true');
  expect(
    document.documentElement.style.getPropertyValue('--agent-vibe-intensity'),
  ).toBeTruthy();

  await activatePromise;

  expect(api.getState().vibeMode).toBe(false);
  expect(document.documentElement.dataset.agentVibeMode).toBeUndefined();
  expect(
    document.documentElement.style.getPropertyValue('--agent-vibe-intensity'),
  ).toBe('');
});

test('api state includes vibe mode alongside toy and audio state', () => {
  const api = initAgentAPI();
  setCurrentToy('milkdrop');
  setAudioActive(true, 'demo');

  expect(api.getState()).toMatchObject({
    currentToy: 'milkdrop',
    toyLoaded: true,
    audioActive: true,
    audioSource: 'demo',
    vibeMode: false,
  });
});

test('debug snapshots are exposed through the agent api', () => {
  const api = initAgentAPI();
  setDebugSnapshot('milkdrop', { presetId: 'milkdrop', status: 'ok' });

  expect(api.getDebugSnapshot('milkdrop')).toEqual({
    presetId: 'milkdrop',
    status: 'ok',
  });

  clearDebugSnapshot('milkdrop');
  expect(api.getDebugSnapshot('milkdrop')).toBeNull();
});

test('returnToLibrary closes the innermost open panel', () => {
  // happy-dom keeps KeyboardEvent on window only; a browser has it global.
  const scope = globalThis as { KeyboardEvent?: unknown };
  const hadKeyboardEvent = 'KeyboardEvent' in scope;
  scope.KeyboardEvent ??= (window as unknown as typeof scope).KeyboardEvent;
  const api = initAgentAPI();
  let closed = 0;
  const unregister = registerEscapeHandler(() => {
    closed += 1;
  });
  try {
    api.returnToLibrary();
    expect(closed).toBe(1);
  } finally {
    unregister();
    if (!hadKeyboardEvent) delete scope.KeyboardEvent;
  }
});
