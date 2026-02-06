import { expect, test } from 'bun:test';
import {
  initAgentAPI,
  setAudioActive,
  setCurrentToy,
} from '../assets/js/core/agent-api.ts';

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
  setCurrentToy('holy');
  setAudioActive(true, 'demo');

  expect(api.getState()).toMatchObject({
    currentToy: 'holy',
    toyLoaded: true,
    audioActive: true,
    audioSource: 'demo',
    vibeMode: false,
  });
});
