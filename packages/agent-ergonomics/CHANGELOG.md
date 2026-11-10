# Changelog

## 0.1.0

- Extract script discovery, quality gates, generated guardrails, documentation/source-text guards
  and Git/PR helpers behind one validated repository configuration and CLI.
- Share the file-level docblock parser across help and documentation consumers.
- Preserve Stims wrapper behavior and carry reusable regression tests into the package.
- Add `outline` and `where`, which read code by declaration and line range through the optional
  peer `@swc/core`, and let bare words narrow the `help` listing by script name.
