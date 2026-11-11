# Changelog

## Unreleased

- B and the back keys close an open native `<dialog>`, which ignores a synthetic Escape. They use `requestClose()`, or dispatch `cancel` and call `close()` where that is missing, so a `cancel` listener can refuse. `closedby="none"` is left open. A dialog your own Escape listener already closed is not closed twice, and one beneath it stays open.
- The synthetic Escape is now cancelable. Calling `preventDefault()` on it keeps a native dialog open, as it does for a real Escape.
- With `keyboardNavigation`, a real Escape on an open native dialog is no longer canceled, so the browser closes it.
- An element under an `inert` ancestor, set as an attribute or a property, and a form control in a `<fieldset disabled>` outside its first `<legend>`, are no longer focus candidates. Both pass `checkVisibility()`, but their `focus()` did nothing, so RB stopped at them.
- With `keyboardNavigation`, a `textarea` and a `number` input keep their editing keys, as text-type inputs already did. Backspace deletes instead of going back, which had also closed a native `<dialog>` around the field. Arrows in a `textarea` move the caret, and a `number` input keeps Up and Down to step its value.
- With `keyboardNavigation`, a text field no longer traps the remote. The back keys other than Backspace go back from one, where only Escape did, and an arrow moves focus once the caret is at the end of the text that way. Up and Down move focus from a single-line field at once.
- An element is no longer a focus candidate when an ancestor hides it (`display: none`, `[hidden]`) or, with `checkVisibility()`, inside a closed `<details>`. Its `focus()` did nothing, so RB could not get past it when it was next in document order, and left from a top-left button picked its box at the origin and stayed put.

## 0.1.0 (2026-10-28)

First release as a package, extracted from
[zz-plant/stims](https://github.com/zz-plant/stims).
- `initGamepadNavigation`: D-pad and left-stick focus movement by geometry
  with document-order fallback, A to activate, B as Escape, bumpers to step,
  range-input stepping, held-direction repeat timers, focus restore through
  `sessionStorage`, the `gamepad-active` body class, and the optional
  keyboard-as-remote layer with Tizen and webOS key codes, carried over with
  its tests.
- `shouldHandleBackKey`, `shouldHandleEnterLikeKey` and
  `shouldDispatchEscapeFallback`, the key classifiers, exported as before.
- New: `DEFAULT_FOCUSABLE_SELECTOR` and the `GamepadNavigationOptions` and
  `FocusDirection` types are exported.
- The default `focusStorageKey` is `gamepad-navigation:last-focus`; it was the
  app's own prefix.
