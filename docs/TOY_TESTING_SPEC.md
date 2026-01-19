# Toy Testing Specification

This specification provides step-by-step instructions for implementing automated tests for each stim toy. It is designed for handoff to another agent or developer.

## Overview

The goal is to validate every toy's **lifecycle contract**: that each module can be loaded, started with stub dependencies, and cleaned up without leaving orphaned DOM nodes or audio resources.

### Toy Types

| Type | Pattern | Test Strategy |
|------|---------|---------------|
| `module` | Exports `start({ container, canvas?, audioContext? })` returning cleanup function | Import and invoke with stubs |
| `page` | Exports `start({ container })` using `startPageToy()` wrapper | Verify CTA status element creation and disposal |

---

## Implementation Steps

### Step 1: Extend Test Helpers

**File**: `tests/toy-test-helpers.ts`

Add these exports to the existing file:

```typescript
export function createFakeCanvas(id = 'test-canvas') {
  const canvas = document.createElement('canvas');
  canvas.id = id;
  canvas.width = 800;
  canvas.height = 600;
  canvas.getContext = () => ({
    getParameter: () => 0,
    getExtension: () => null,
    drawArrays: () => {},
    clear: () => {},
  });
  return canvas;
}

export function createMockScene() {
  return {
    add: () => {},
    remove: () => {},
    children: [],
    dispose: () => {},
  };
}
```

---

### Step 2: Create Lifecycle Harness

**File**: `tests/toy-lifecycle-harness.ts`

```typescript
import { afterEach, beforeEach } from 'bun:test';
import { createFakeCanvas, createToyContainer, FakeAudioContext } from './toy-test-helpers';

export type ToyTestContext = {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  audioContext: FakeAudioContext;
  cleanup: (() => void | Promise<void>) | null;
};

export function setupToyTest(): ToyTestContext {
  const { container, dispose } = createToyContainer('toy-test-container');
  const canvas = createFakeCanvas();
  container.appendChild(canvas);
  const audioContext = new FakeAudioContext();

  return {
    container,
    canvas,
    audioContext,
    cleanup: dispose,
  };
}

export async function runToyStart(
  startFn: (opts: { container: HTMLElement; canvas?: HTMLCanvasElement; audioContext?: unknown }) => unknown,
  ctx: ToyTestContext
) {
  const result = startFn({
    container: ctx.container,
    canvas: ctx.canvas,
    audioContext: ctx.audioContext,
  });
  
  // Handle both sync and async cleanup functions
  if (typeof result === 'function') return result;
  if (result && typeof (result as { dispose?: () => void }).dispose === 'function') {
    return () => (result as { dispose: () => void }).dispose();
  }
  return () => {};
}
```

---

### Step 3: Parameterized Toy Tests

**File**: `tests/toys.test.ts`

```typescript
import { afterEach, describe, expect, test } from 'bun:test';
import toys from '../assets/js/toys-data.js';
import { setupToyTest, runToyStart, type ToyTestContext } from './toy-lifecycle-harness';

const testableToys = toys.filter(t => t.type === 'module');

describe.each(testableToys)('toy lifecycle: $slug', ({ slug, module }) => {
  let ctx: ToyTestContext;
  let toyCleanup: (() => void | Promise<void>) | null = null;

  afterEach(async () => {
    if (toyCleanup) await toyCleanup();
    ctx.cleanup?.();
    document.body.innerHTML = '';
  });

  test('module exports start function', async () => {
    const mod = await import(`../${module}`);
    expect(typeof mod.start).toBe('function');
  });

  test('start returns cleanup function', async () => {
    ctx = setupToyTest();
    const mod = await import(`../${module}`);
    toyCleanup = await runToyStart(mod.start, ctx);
    expect(typeof toyCleanup).toBe('function');
  });

  test('cleanup removes container children', async () => {
    ctx = setupToyTest();
    const mod = await import(`../${module}`);
    toyCleanup = await runToyStart(mod.start, ctx);
    
    const childCountBefore = ctx.container.childElementCount;
    await toyCleanup?.();
    toyCleanup = null;
    
    // Canvas may remain; toy-added nodes should be gone
    expect(ctx.container.childElementCount).toBeLessThanOrEqual(childCountBefore);
  });
});
```

> [!NOTE]
> Some toys like `evol` and `geom` use `startPageToy()`. A separate describe block should handle page-based toys by asserting the CTA status element is added and removed.

---

### Step 4: Smoke Tests for Metadata

**File**: `tests/toy-smoke.test.ts`

```typescript
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import toys from '../assets/js/toys-data.js';

describe('toy metadata smoke tests', () => {
  test.each(toys)('$slug entry exists', async ({ slug, module, type }) => {
    const modulePath = path.resolve(process.cwd(), module);
    const exists = await fs.access(modulePath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  test.each(toys.filter((toy) => toy.type === 'module'))('$slug exports start function', async ({ module }) => {
    const mod = await import(`../${module}`);
    expect(typeof mod.start).toBe('function');
  });
});
```

---

### Step 5: Update QA_PLAN.md

Add this section after "How to run the QA automation":

```markdown
## Toy lifecycle tests

Each toy module is validated for lifecycle correctness:

- **Module export**: Every registered toy exports a `start` function
- **Cleanup contract**: `start()` returns a cleanup function or disposable object
- **DOM isolation**: Cleanup removes toy-injected DOM nodes

Run the toy test suite:

```bash
bun test tests/toys.test.ts tests/toy-smoke.test.ts
```

When adding new toys via `scripts/scaffold-toy.ts --with-test`, a starter spec is generated automatically.
```

---

## Edge Cases to Handle

### WebGPU-Only Toys

Toys with `requiresWebGPU: true` may fail if renderer stubs are insufficient. Handle with:

```typescript
const webgpuToys = toys.filter(t => t.requiresWebGPU);

describe.skip.each(webgpuToys)('WebGPU toy: $slug (skipped in headless)', () => {
  // These require browser-level WebGPU; document as manual test
});
```

### Page-Based Toys

Toys like `evol`, `geom`, `holy`, `legible`, `lights`, `multi`, `seary`, `symph` use `startPageToy()`. Test their wrapper:

```typescript
test('page toy creates and disposes CTA status', async () => {
  const mod = await import('../assets/js/toys/evol.ts');
  const container = document.createElement('div');
  document.body.appendChild(container);
  
  const activeToy = mod.start({ container });
  expect(container.querySelector('.active-toy-status')).not.toBeNull();
  
  activeToy.dispose();
  expect(container.querySelector('.active-toy-status')).toBeNull();
});
```

---

## Verification Checklist

Before marking complete:

- [ ] `bun test tests/toys.test.ts` passes for all module toys
- [ ] `bun test tests/toy-smoke.test.ts` validates all 25 toy slugs
- [ ] `bun run check` passes (lint, typecheck, full suite)
- [ ] `QA_PLAN.md` updated with toy testing section
- [ ] No orphan DOM nodes after test completion (document.body is clean)

---

## Adding Tests for New Toys

When scaffolding a new toy with `--with-test`:

```bash
bun run scripts/scaffold-toy.ts --slug my-toy --title "My Toy" --type module --with-test
```

The generated test file follows the pattern in this spec. Ensure:

1. Test imports from `toy-test-helpers.ts`
2. Uses `setupToyTest()` for consistent environment
3. Verifies both start and cleanup paths
