// The gamepad-navigation site: the real library on a page of plain controls,
// from the bundle built by scripts/build-site.ts.
import { initGamepadNavigation } from './lib/gamepad-navigation.js';

const $ = (id) => document.getElementById(id);

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = 'copied';
      setTimeout(() => {
        button.textContent = 'copy';
      }, 1200);
    } catch {
      button.textContent = 'select it';
    }
  });
}

let stop = null;
const start = () => {
  stop?.();
  stop = initGamepadNavigation({
    keyboardNavigation: $('keyboard').checked,
    focusStorageKey: 'gamepad-navigation-site:last-focus',
  });
};
start();
$('keyboard').addEventListener('change', start);

const describe = (element) => {
  if (!element || element === document.body) return 'body';
  const tag = element.tagName.toLowerCase();
  return element.id ? `${tag}#${element.id}` : tag;
};

const log = (text) => {
  $('event').textContent = text;
};

document.addEventListener('focusin', (event) => {
  $('focused').textContent = describe(event.target);
});
document.addEventListener('keydown', (event) => {
  log(
    `keydown ${event.key}${event.key === 'Unidentified' ? ` (${event.keyCode})` : ''}`,
  );
});
document.addEventListener('click', (event) => {
  if (event.target instanceof HTMLButtonElement) {
    log(`click ${describe(event.target)}`);
  }
});
$('volume').addEventListener('input', (event) => {
  $('volume-out').textContent = event.target.value;
  log(`input volume=${event.target.value}`);
});

const dialog = $('dialog');
$('b-dialog').addEventListener('click', () => {
  dialog.showModal();
  $('d-ok').focus();
});
for (const id of ['d-ok', 'd-cancel']) {
  $(id).addEventListener('click', () => dialog.close());
}
dialog.addEventListener('cancel', () => log('dialog closed by Escape'));

const padState = () => {
  const pads = Array.from(navigator.getGamepads?.() ?? []).filter(Boolean);
  $('pad-state').textContent =
    pads.length > 0
      ? `Gamepad: ${pads[0].id}`
      : 'No gamepad connected. Press a button on one, or use the keyboard layer.';
  $('active').textContent = document.body.classList.contains('gamepad-active')
    ? 'yes'
    : 'no';
};
window.addEventListener('gamepadconnected', padState);
window.addEventListener('gamepaddisconnected', padState);
setInterval(padState, 500);
padState();
