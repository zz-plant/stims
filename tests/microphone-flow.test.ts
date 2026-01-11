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

function mockPermissionState(state: PermissionState) {
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: {
      query: mock().mockResolvedValue({ state }),
    },
  });
}

const waitForAsyncTasks = () =>
  new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });

afterEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: undefined,
  });
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
      AudioAccessError,
    );

    expect(statusElement.hidden).toBe(false);
    expect(statusElement.dataset.variant).toBe('error');
    expect(statusElement.textContent).toContain('blocked');
    expect(fallbackButton.hidden).toBe(false);
    expect(startButton.textContent).toContain('Retry microphone');

    const toast = document.querySelector('[data-audio-toast="true"]');
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toContain('permissions');
    expect(toast?.getAttribute('role')).toBe('alert');
  });

  test('communicates timeout guidance and shows retry affordance', async () => {
    const { startButton, fallbackButton, statusElement } = buildDom();

    mockPermissionState('prompt');

    const timeoutPromise = new Promise(() => {});

    const flow = setupMicrophonePermissionFlow({
      startButton,
      fallbackButton,
      statusElement,
      requestMicrophone: () => timeoutPromise,
      timeoutMs: 5,
    });

    await expect(flow.startMicrophoneRequest()).rejects.toBeInstanceOf(
      AudioAccessError,
    );

    expect(statusElement.dataset.variant).toBe('error');
    expect(statusElement.textContent).toContain('timed out');
    expect(fallbackButton.hidden).toBe(false);
    expect(startButton.textContent).toContain('Retry microphone');
  });

  test('restores the original start button label and aria-label after a retry', async () => {
    const { startButton, fallbackButton, statusElement } = buildDom();

    startButton.textContent = 'Enable mic';
    startButton.setAttribute('aria-label', 'Enable microphone visuals');

    const permissionQuery = mock()
      .mockResolvedValueOnce({ state: 'prompt' })
      .mockResolvedValueOnce({ state: 'granted' });

    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: permissionQuery },
    });

    const requestMicrophone = mock()
      .mockRejectedValueOnce(new AudioAccessError('timeout', 'timed out'))
      .mockResolvedValueOnce(undefined);

    const flow = setupMicrophonePermissionFlow({
      startButton,
      fallbackButton,
      statusElement,
      requestMicrophone,
    });

    await expect(flow.startMicrophoneRequest()).rejects.toBeInstanceOf(
      AudioAccessError,
    );

    expect(startButton.dataset.state).toBe('retry');
    expect(startButton.getAttribute('aria-label')).toContain(
      'Retry microphone',
    );
    expect(fallbackButton.hidden).toBe(false);

    await flow.startMicrophoneRequest();

    expect(requestMicrophone).toHaveBeenCalledTimes(2);
    expect(statusElement.dataset.variant).toBe('success');
    expect(startButton.dataset.state).toBeUndefined();
    expect(startButton.textContent).toBe('Enable mic');
    expect(startButton.getAttribute('aria-label')).toBe(
      'Enable microphone visuals',
    );
    expect(fallbackButton.hidden).toBe(true);
  });

  test('removes event listeners when disposed before reinitializing', async () => {
    const { startButton, fallbackButton, statusElement } = buildDom();

    mockPermissionState('granted');

    const firstRequestMicrophone = mock().mockResolvedValue(undefined);

    const firstFlow = setupMicrophonePermissionFlow({
      startButton,
      fallbackButton,
      statusElement,
      requestMicrophone: firstRequestMicrophone,
    });

    firstFlow.dispose?.();

    const secondRequestMicrophone = mock().mockResolvedValue(undefined);

    const secondFlow = setupMicrophonePermissionFlow({
      startButton,
      fallbackButton,
      statusElement,
      requestMicrophone: secondRequestMicrophone,
    });

    startButton.click();
    await waitForAsyncTasks();

    expect(firstRequestMicrophone).not.toHaveBeenCalled();
    expect(secondRequestMicrophone).toHaveBeenCalledTimes(1);

    secondFlow.dispose?.();
  });
});
