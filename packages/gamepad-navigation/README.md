# gamepad-navigation

Focus navigation for gamepads and TV remotes, over the DOM you already have. One call polls the connected pad and turns it into focus: directions go to the nearest focusable element by geometry, A clicks, B sends Escape, the bumpers step in document order, and a focused slider moves by its `step`. With `keyboardNavigation` on, the keyboard gets the same mapping, because that is how a TV remote arrives: Tizen and webOS send key events, not Gamepad API input. Pure TypeScript, no dependencies. It was built for [Stims](https://toil.fyi), a MilkDrop visualizer people run on a TV from the couch.

Demo: the [gamepad-navigation site](https://zz-plant.github.io/stims/gamepad-navigation/) runs the library on a page of plain controls, with a pad or the arrow keys.

## Install

```sh
npm install gamepad-navigation
# or
bun add gamepad-navigation
```

## Quick start

Call it once in a browser. It returns the function that removes its listeners.

```ts
import { initGamepadNavigation } from 'gamepad-navigation';

document.body.innerHTML = `
  <button id="play" style="position:absolute;left:0;top:0">Play</button>
  <button id="next" style="position:absolute;left:200px;top:0">Next</button>
  <button id="quality" style="position:absolute;left:0;top:100px">Quality</button>`;
document
  .querySelector('#next')
  ?.addEventListener('click', () => console.log('clicked next'));

const stop = initGamepadNavigation({ keyboardNavigation: true });
console.log('on start:', document.activeElement?.id);

const press = (key: string) =>
  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );

press('ArrowRight');
console.log('right:', document.activeElement?.id);
press('Enter');
press('ArrowLeft');
press('ArrowDown');
console.log('left, down:', document.activeElement?.id);
console.log('body class:', document.body.className);

stop();
```

Output, as printed by headless Chromium 156 running that file against the packed tarball:

```
on start: play
right: next
clicked next
left, down: quality
body class: gamepad-active
```

Leave `keyboardNavigation` off on a desktop or a phone. See [The keyboard layer](#the-keyboard-layer).

### With a pad

No hardware is needed to try this: the file below scripts `navigator.getGamepads`. On a focused slider, D-pad right adds one `step` instead of leaving it, and B dispatches Escape.

```ts
import { initGamepadNavigation } from 'gamepad-navigation';

document.body.innerHTML = `
  <input id="volume" type="range" min="0" max="10" step="2" value="4">
  <button id="ok" style="position:absolute;left:400px;top:0">OK</button>`;
const volume = document.querySelector<HTMLInputElement>('#volume');
volume?.addEventListener('input', () => console.log('volume:', volume.value));
document.addEventListener('keydown', (event) => console.log('keydown:', event.key));

// A scripted pad in the standard mapping: button 15 is D-pad right, 1 is B.
const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
const pad = { connected: true, axes: [0, 0], buttons };
navigator.getGamepads = () => [pad as unknown as Gamepad];

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (--n > 0 ? requestAnimationFrame(step) : resolve());
    requestAnimationFrame(step);
  });

const stop = initGamepadNavigation({ restoreFocus: false });
volume?.focus();

await frames(2);
const right = buttons[15];
if (right) right.pressed = true;
await frames(2); // one step, then the repeat timer holds the rest
if (right) right.pressed = false;
await frames(2);

const back = buttons[1];
if (back) back.pressed = true;
await frames(2);
if (back) back.pressed = false;

console.log('still focused:', document.activeElement?.id);
stop();
```

Output, from the same run:

```
volume: 6
keydown: Escape
still focused: volume
```

## Mapping

Buttons follow the [standard gamepad layout](https://w3c.github.io/gamepad/#remapping). Only the first connected pad is read, and only while the tab is visible.

| Input                                         | Does                                                                                                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-pad (buttons 12 to 15), left stick          | Focus the nearest element in that direction. With none that way, step in document order and wrap.                                                    |
| Left or right, slider focused (pad only)      | Add or subtract its `step`, clamped to `min` and `max`, and dispatch `input`.                                                                        |
| Direction held                                | First move at once, the second after `initialRepeatDelayMs`, then one every `repeatIntervalMs`.                                                      |
| A (button 0)                                  | Click the focused element. With focus on `body`, the click lands on `body`.                                                                          |
| B (button 1)                                  | Dispatch a synthetic `Escape` keydown on `document`, then close an open native `<dialog>`. See [Closing a native dialog](#closing-a-native-dialog).  |
| LB, RB (buttons 4, 5)                         | Previous and next in document order.                                                                                                                 |
| Arrow keys, with `keyboardNavigation`         | Move focus as the D-pad does. In a text field they move the caret first. See [Keys in a text field](#keys-in-a-text-field).                          |
| Enter, NumpadEnter, OK, Select, Return, Spacebar, with the same flag | Click the focused element. Key codes 13, 32 and 23 count when the key reads `Unidentified`.                                                          |
| Backspace, Back, Exit, GoBack, BrowserBack, MediaBack, with the same flag | Dispatch `Escape` as B does. So do key codes 8, 27, 166, 461 (webOS) and 10009 (Tizen). A real `Escape` key is not re-dispatched, and on an open native `<dialog>` it is left for the browser. In a text field, Backspace deletes instead. |

## How it picks a target

- **By distance from centre to centre.** A candidate counts for a direction when it lies within 45 degrees of that axis. Its score is the distance along the axis plus 0.35 of the distance across it, and the lowest score wins.
- **Inside the open modal.** While a `dialog[open]` or `[role="dialog"][aria-modal="true"]` exists, only elements inside it are candidates.
- **From `DEFAULT_FOCUSABLE_SELECTOR`.** That is links, enabled form controls, `[tabindex]` other than -1, and `details > summary`, the only toggle of a disclosure.
- **Only what is rendered.** An element is skipped when it or an ancestor is `display: none`, including `[hidden]`, or when it is hidden itself with `visibility: hidden`. Inside a closed `<details>`, it is skipped where the browser has `checkVisibility()`.
- **Only what can take focus.** An element under an `inert` ancestor is skipped, whether the page set the attribute or the `inert` property. So is a form control in a `<fieldset disabled>`, unless it sits in the fieldset's first `<legend>`; links there stay candidates. Both keep their box, so `checkVisibility()` passes them, but their `focus()` does nothing.

## Closing a native dialog

A browser ignores a synthetic Escape, so B and the back keys close an open `<dialog>` themselves: the one holding focus, or else the one bounding focus moves. Using `requestClose()`, or where that is missing, dispatching `cancel` and calling `close()`, keeps these working:

- **A `cancel` listener can refuse.** Calling `preventDefault()` on it keeps the dialog open.
- **Your own Escape listener still runs first.** Calling `preventDefault()` on that keydown keeps the dialog open, as it does for a real Escape, so a popover inside can take the press. If your listener closes the dialog itself, it closes once, and a dialog beneath stays open.
- **`closedby="none"` stays open.** The page has said the user cannot dismiss it, so give it a button.

A `[role="dialog"]` element gets the Escape keydown only, so it needs a listener of its own, which it usually has already.

## Keys in a text field

With `keyboardNavigation` on, a focused text-type input, `textarea` or `number` input keeps the keys it needs for editing, and the layer acts on the rest:

| Key                                   | Text-type input                    | `textarea`                         | `number` input           |
| ------------------------------------- | ---------------------------------- | ---------------------------------- | ------------------------ |
| Backspace, key code 8                 | Deletes                            | Deletes                            | Deletes                  |
| Enter, typing                         | The field's own                    | The field's own                    | The field's own          |
| Left, Right                           | Move the caret; move focus from the end of the text | Move the caret; move focus from the end of the text | Move focus |
| Up, Down                              | Move focus                         | Move the caret; move focus from the end of the text | Step the value |
| Escape and the remote's back keys     | Go back                            | Go back                            | Go back                  |

"The end of the text" is the start for Left and Up and the end for Right and Down, with nothing selected. In an `email` input, which exposes no caret, Left and Right stay with the field. Going back from a field inside a panel or a native `<dialog>` closes it, which is how a remote leaves one.

## What to plan for

These come from reading the code and running it in Chromium 156 and 158.

- **Focus moves on init, pad or no pad.** With `restoreFocus` on, the default, and nothing focused, the call focuses the remembered element or the first focusable one. Pass `restoreFocus: false` to keep it from moving focus when it starts.
- **A pad's directions stop at a text-type input.** The D-pad and stick do nothing while one has focus, since a pad cannot move its caret. Leave with LB, RB or B. A `textarea` or `number` input is left on any direction.
- **Some editable elements are not treated as fields.** Date and time inputs and `contenteditable` elements get the plain mapping: with `keyboardNavigation` on, arrows move focus and Backspace goes back.

## The keyboard layer

Turn it on only where the keyboard is a remote. In Stims, which detects a smart TV and passes the result as this flag, it once ran on every device. Each arrow press that changed preset also walked focus along one element, which left a skip link visible over the picture, and each Backspace closed whatever panel was open.

The layer moves focus off a slider instead of stepping it, so a slider cannot be changed from a remote.

## API

| Export                                | Purpose                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| `initGamepadNavigation(options?)`     | Installs the listeners and returns the function that removes them.                          |
| `shouldHandleBackKey(event)`          | Whether a keydown is a back key, by name or by legacy key code.                             |
| `shouldHandleDirectionalKey(event)`   | Whether a keydown is an arrow key the keyboard layer moves focus with.                      |
| `shouldHandleEnterLikeKey(event)`     | Whether a keydown is Enter or OK. Key codes count only when the key reads `Unidentified`.   |
| `shouldDispatchEscapeFallback(key)`   | Whether a back key should dispatch Escape: every key but `Escape` itself.                   |
| `DEFAULT_FOCUSABLE_SELECTOR`          | The default value of `focusableSelector`.                                                   |
| `GamepadNavigationOptions`, `FocusDirection` | Types.                                                                               |

The three `shouldHandle…Key` predicates are also exported from `gamepad-navigation/keys`, which does not load the rest of the layer. A page that defers the layer can use them to let those keys through to it.

| Option                 | Default                         | Purpose                                                                |
| ---------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| `focusableSelector`    | `DEFAULT_FOCUSABLE_SELECTOR`    | Which elements focus can land on.                                      |
| `activeClass`          | `'gamepad-active'`              | Class on `body` once a pad or the keyboard layer has been used. Use it for a visible focus ring. |
| `axisThreshold`        | `0.55`                          | Stick deflection, 0 to 1, that counts as a direction.                  |
| `initialRepeatDelayMs` | `220`                           | Delay before a held direction repeats.                                 |
| `repeatIntervalMs`     | `120`                           | Interval between repeats.                                              |
| `restoreFocus`         | `true`                          | Remember the focused element in `sessionStorage` and restore it.       |
| `focusStorageKey`      | `'gamepad-navigation:last-focus'` | Key prefix for that memory. The page's path and query are appended.  |
| `keyboardNavigation`   | `false`                         | Treat the keyboard as a D-pad.                                         |

An element is remembered by its `id` or `data-focus-key`, and otherwise by its position among the focusable elements.

## Development

The code is developed in [zz-plant/stims](https://github.com/zz-plant/stims) under [`packages/gamepad-navigation`](https://github.com/zz-plant/stims/tree/main/packages/gamepad-navigation), next to the app that uses it, and released from there. Open issues and pull requests on zz-plant/stims.

```sh
bun install --frozen-lockfile
bun --cwd=packages/gamepad-navigation run build
bun --cwd packages/gamepad-navigation test
```

The tests run under [happy-dom](https://github.com/capricorn86/happy-dom), which is why this package has a third dev dependency. It lays nothing out, so the geometry tests give their elements a bounding box by hand.

## Provenance

Extracted from [zz-plant/stims](https://github.com/zz-plant/stims):

| Package file                                  | Stims source                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/index.ts`                                | `src/js/utils/browser/gamepad-navigation.ts`, with the default storage key renamed                |
| `tests/keys.test.ts`, `tests/focus.test.ts`   | `tests/unit/utils/gamepad-navigation.test.ts`, `gamepad-navigation-focus.test.ts`, plus geometry and pad tests |

`bun test` runs 43 tests across 2 files.

## License

[Unlicense](https://github.com/zz-plant/stims/blob/main/packages/gamepad-navigation/LICENSE). Public domain.
