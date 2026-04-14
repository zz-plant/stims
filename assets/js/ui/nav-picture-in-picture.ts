import {
  exitToyPictureInPicture,
  getToyPictureInPictureVideo,
  isPictureInPictureSupported,
  isToyPictureInPictureActive,
  requestToyPictureInPicture,
} from '../utils/picture-in-picture';
import { replaceIconContents } from './icon-library.ts';

export function setupPictureInPictureControls(
  container: HTMLElement,
  doc: Document,
) {
  const pipButton = container.querySelector<HTMLButtonElement>(
    '[data-toy-pip="true"]',
  );
  const pipStatus = container.querySelector<HTMLElement>(
    '.toy-nav__pip-status',
  );

  if (!pipButton || !pipStatus) return;

  const updateButtonState = () => {
    const active = isToyPictureInPictureActive(doc);
    const icon = pipButton.querySelector('.toy-nav__button-icon');
    const label = pipButton.querySelector('.toy-nav__button-label');
    pipButton.setAttribute('aria-pressed', String(active));
    replaceIconContents(icon, active ? 'close' : 'picture-in-picture', {
      title: active ? 'Close mini player' : 'Mini player',
    });
    if (label) {
      label.textContent = active ? 'Close mini player' : 'Mini player';
    }
  };

  const showStatus = (message: string) => {
    pipStatus.textContent = message;
    if (!message) return;
    const win = doc.defaultView ?? window;
    win.setTimeout(() => {
      if (pipStatus.textContent === message) {
        pipStatus.textContent = '';
      }
    }, 3200);
  };

  let pipPermanentlyDisabled = false;

  const disablePip = (message: string) => {
    pipButton.disabled = true;
    pipButton.setAttribute('aria-disabled', 'true');
    pipButton.setAttribute('title', message);
    pipButton.removeAttribute('aria-busy');
    showStatus(message);
    pipPermanentlyDisabled = true;
  };

  if (!isPictureInPictureSupported(doc)) {
    disablePip('Picture-in-picture is not available in this browser.');
    return;
  }

  updateButtonState();

  const video = getToyPictureInPictureVideo(doc);
  video.onenterpictureinpicture = () => updateButtonState();
  video.onleavepictureinpicture = () => updateButtonState();

  pipButton.addEventListener('click', async () => {
    const wasActive = isToyPictureInPictureActive(doc);
    pipButton.disabled = true;
    pipButton.setAttribute('aria-busy', 'true');
    showStatus(
      wasActive ? 'Closing picture in picture…' : 'Opening picture in picture…',
    );

    try {
      if (wasActive) {
        await exitToyPictureInPicture(doc);
      } else {
        await requestToyPictureInPicture(doc);
      }
      updateButtonState();
      showStatus(wasActive ? 'Mini player closed.' : 'Mini player enabled.');
    } catch (_error) {
      const error = _error as Error | DOMException;
      const errorName = 'name' in error ? error.name : '';
      if (errorName === 'NotSupportedError') {
        disablePip('Picture-in-picture is not available in this browser.');
      } else {
        showStatus('Unable to open the mini player.');
      }
      updateButtonState();
    } finally {
      if (!pipPermanentlyDisabled) {
        pipButton.disabled = false;
        pipButton.removeAttribute('aria-busy');
      }
    }
  });
}
