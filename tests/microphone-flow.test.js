import { afterEach, describe, expect, mock, test } from 'bun:test';
import { setupMicrophonePermissionFlow } from '../assets/js/core/microphone-flow.ts';
import { AudioAccessError } from '../assets/js/utils/audio-handler.ts';

function buildDom() {
  const startButton = document.createElement('button');
  const fallbackButton = document.createElement('button');
  fallbackButton.hidden = true;
  const statusElement = document.createElement('div');
  statusElement.hidden = true;

  document.body.appendChild(startButton);
  document.body.appendChild(fallbackButton);
  document.body.appendChild(statusElement);

  return { startButton, fallbackButton, statusElement };
}

function mockPermissionState(state) {
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: {
      query: mock().mockResolvedValue({ state }),
    },
  });
}

afterEach(() => {
  document.body.innerHTML = '';
  delete navigator.permissions;
});

describe('setupMicrophonePermissionFlow', () => {
  test('marks success after microphone start and keeps fallback hidden', async () => {
    const { startButton, fallbackButton, statusElement } = buildDom();

    mockPermissionState('granted');

    const requestMicrophone = mock().mockResolvedValue(undefined);

    const flow = setupMicrophonePermissionFlow({
      startButton,
      fallbackButton,
      statusElement,
      requestMicrophone,
    });

    await flow.startMicrophoneRequest();

    expect(requestMicrophone).toHaveBeenCalled();
    expect(statusElement.hidden).toBe(false);
    expect(statusElement.dataset.variant).toBe('success');
    expect(statusElement.textContent).toContain('Microphone connected');
    expect(fallbackButton.hidden).toBe(true);
  });

  test('surfaces denied permissions and reveals fallback action', async () => {
    const { startButton, fallbackButton, statusElement } = buildDom();

    mockPermissionState('denied');

    const requestMicrophone = mock().mockResolvedValue(undefined);

    const flow = setupMicrophonePermissionFlow({
      startButton,
      fallbackButton,
      statusElement,
      requestMicrophone,
    });

    await expect(flow.startMicrophoneRequest()).rejects.toBeInstanceOf(
      AudioAccessError
    );

    expect(statusElement.hidden).toBe(false);
    expect(statusElement.dataset.variant).toBe('error');
    expect(statusElement.textContent).toContain('blocked');
    expect(fallbackButton.hidden).toBe(false);
  });
});

