const ERROR_ELEMENT_ID = 'error-message';

function getErrorElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById(ERROR_ELEMENT_ID);
}

export function showError(message: string) {
  const el = getErrorElement();
  if (!el) return;

  el.textContent = message;
  el.style.display = 'block';
}

export function hideError() {
  const el = getErrorElement();
  if (!el) return;

  el.textContent = '';
  el.style.display = 'none';
}

export const AUDIO_UNAVAILABLE_MESSAGE =
  'Microphone access is unavailable. Visuals will run without audio reactivity.';

export function showAudioUnavailableError() {
  showError(AUDIO_UNAVAILABLE_MESSAGE);
}
