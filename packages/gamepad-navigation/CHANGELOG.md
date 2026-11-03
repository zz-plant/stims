# Changelog

## Unreleased

- B and the back keys close an open native `<dialog>`, which ignores a synthetic Escape. They use `requestClose()`, or dispatch `cancel` and call `close()` where that is missing, so a `cancel` listener can refuse. `closedby="none"` is left open. A dialog your own Escape listener already closed is not closed twice, and one beneath it stays open.
- The synthetic Escape is now cancelable. Calling `preventDefault()` on it keeps a native dialog open, as it does for a real Escape.
- With `keyboardNavigation`, a real Escape on an open native dialog is no longer canceled, so the browser closes it.
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
