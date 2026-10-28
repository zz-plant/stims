# Changelog

## 0.1.0

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
