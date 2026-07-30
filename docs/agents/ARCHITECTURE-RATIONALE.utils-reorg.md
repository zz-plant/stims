# Architecture Rationale: Utils Reorganization

## Problem

`src/js/utils/` had 21 flat `.ts` files with no internal structure. An audit found 13/21 files (62%) were dead code — zero imports from any source file. The remaining 8 live files mixed audio, browser, media, and Three.js concerns at the same level, making it harder to find what's still active.

The flat layout also meant any new utility was added to the root, with no natural home. Over time this created the dead-code accumulation.

## What changed

- Removed all 13 dead files and their stale `.js` build twins
- Moved the 8 live files into subdirectories by domain: `audio/`, `browser/`, `media/`, `three/`
- Mirrored the same structure under `tests/unit/utils/`
- Added `.gitignore` rules to prevent `.js` build artifacts from cluttering the tree

## What the restructure enables

- New utils have a clear domain home — no more "just dump it in root"
- Dead files can't hide in a flat list; a subdirectory with no files is easier to spot
- Tests mirror the source, so a utils change's test coverage is obvious from the directory
- Cleaner mental model: audio utilities vs browser/platform utilities vs media IO vs Three.js helpers
