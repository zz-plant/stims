# Toy Testing Specification

Guidance for writing automated tests for stim toys. This spec focuses on **repeatable lifecycle checks** and **shared test helpers** so new toy tests follow consistent patterns.

## Goals

- Validate toy lifecycle behavior (start, render/update, cleanup).
- Keep tests headless (Bun + happy-dom) and deterministic.
- Favor fast, isolated tests for pure helpers and rendering utilities.

## What already exists

The repo already ships with shared helpers in `tests/toy-test-helpers.ts` and a working example spec in `tests/sample-toy.test.ts`.

### Shared helpers

- `createToyContainer(id?)`: Creates and appends a container to `document.body` and returns `{ container, dispose }`.
- `FakeAudioContext`: Lightweight fake with `createAnalyser()` and `close()` tracking for cleanup assertions.
- `createMockRenderer()`: Provides a stub renderer with `renderFrame()` and a `dispose()` spy.

Use these helpers as the starting point for new toy tests instead of creating ad-hoc stubs.

### Example harness

`tests/sample-toy.test.ts` demonstrates the expected flow for a module toy:

1. Create a container + audio context.
2. Call `start()` with the stubbed dependencies.
3. Assert DOM mounts or other side effects.
4. Call the cleanup function and assert cleanup behavior.

## Recommended test patterns

### 1) Module toys (default pattern)

Use this pattern for toys that export `start({ container, canvas?, audioContext? })` and return a cleanup function (or a disposable object).

```ts
import { describe, expect, test } from 'bun:test';
import { start } from '../assets/js/toys/my-toy.ts';
import { createToyContainer, FakeAudioContext } from './toy-test-helpers.ts';

describe('my-toy', () => {
  test('starts and cleans up', async () => {
    const { container, dispose } = createToyContainer('my-toy-root');
    const audioContext = new FakeAudioContext();

    const cleanup = start({ container, audioContext });

    expect(typeof cleanup).toBe('function');
    expect(container.childElementCount).toBeGreaterThan(0);

    await cleanup();

    expect(container.childElementCount).toBe(0);
    expect(audioContext.closed).toBe(true);

    dispose();
  });
});
```

Notes:
- If a toy returns `{ dispose() }`, wrap it into a `cleanup` function inside the test.
- Always reset `document.body` in `afterEach` when you add additional nodes.

### 2) Page toys (`startPageToy` wrappers)

For toys that export `start({ container })` and use the page wrapper, assert that the **active toy status UI** mounts and unmounts cleanly.

```ts
import { expect, test } from 'bun:test';
import { start } from '../assets/js/toys/holy.ts';

test('page toy mounts and disposes status UI', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const activeToy = start({ container });
  expect(container.querySelector('.active-toy-status')).not.toBeNull();

  activeToy.dispose();
  expect(container.querySelector('.active-toy-status')).toBeNull();
});
```

### 3) Helper utilities

When adding new helpers (color math, easing, or audio utilities), write small unit tests under `tests/` and use `createMockRenderer()` or `FakeAudioContext` as needed.

## Smoke checks for toy metadata

If you change the toy registry (`assets/data/toys.json`) or entry points, consider updating or extending `scripts/check-toys.ts` tests so metadata stays consistent. The `tests/check-toys.test.ts` file covers this workflow with a temporary repo fixture.

## Verification checklist

Before marking a toy test complete:

- [ ] The new spec reuses helpers from `tests/toy-test-helpers.ts`.
- [ ] Cleanup removes toy-added DOM nodes and closes the fake audio context when applicable.
- [ ] `bun run check` passes (lint, typecheck, and tests).
