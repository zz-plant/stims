# Changelog

All notable changes to this project will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

_Current release status: actively developed. The latest tagged release is **1.0.0** and ongoing updates will appear in **Unreleased**._

## [Unreleased]

### Added

- Capability preflight panel with compatibility checks, retry guidance, and clear fallback messaging.
- Preflight support links that explain why rendering is blocked and point to supported browsers and demo-audio toys.
- Performance controls with persistent pixel ratio, particle budget, and shader-quality presets.
- Low-motion quality preset and inline preset descriptions to clarify performance tradeoffs.
- Audio source controls that surface demo audio alongside the microphone option with clearer status copy.
- Immediate “starting” status feedback when launching microphone, demo, or tab audio.
- Shared touch/gesture handling that normalizes multi-touch input and touch-action defaults across toys.

### Changed

- Clarified the roadmap to distinguish delivered foundations from upcoming priorities.

## [1.0.0] - 2025-02-04

### Added

- Initial release of the Stim Webtoys Library with interactive experiences such as [Aurora Painter](./toy.html?toy=aurora-painter), [Defrag Visualizer](./toy.html?toy=defrag), [Multi-Capability Visualizer](./toy.html?toy=multi), [Audio Light Show](./toy.html?toy=lights), and many more listed in the [README](./README.md#toys-in-the-collection).
- Core setup for running toys locally via Vite with Bun or Node.js, including build, preview, lint, and test scripts.

### Changed

- Documented repository layout and contribution guidance to help users navigate assets, utilities, and test suites.

### Fixed

- Clarified local setup to avoid issues when opening HTML files directly without a dev server.

[Unreleased]: https://github.com/zz-plant/stims/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/zz-plant/stims/releases/tag/v1.0.0
