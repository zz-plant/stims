import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  readStored,
  removeStored,
  writeStored,
} from '../../src/js/core/state/browser-storage.ts';
import { useOverlayAnchor } from '../../src/js/frontend/hooks/use-overlay-anchor.ts';
import {
  getPinnedTargets,
  pinTarget,
  unpinTarget,
} from '../../src/js/frontend/perform-pins.ts';
import { SidePanel } from '../../src/js/frontend/SidePanel.tsx';
import { writeShortcutOverrides } from '../../src/js/frontend/shortcut-registry.ts';
import {
  useUI,
  WorkspaceProvider,
} from '../../src/js/frontend/workspace-context.tsx';
import {
  DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  resolveMilkdropWebGpuOptimizationFlags,
} from '../../src/js/milkdrop/webgpu-optimization-flags.ts';

/**
 * Regression: Stims crashed on boot when reading `localStorage` throws.
 *
 * In a sandboxed iframe without `allow-same-origin`, in a third-party iframe
 * under an opaque-origin parent (the `?embed=true` player oEmbed hands to
 * Notion, Medium and Discord), and when the user blocks site data, reading
 * the `localStorage` property itself throws a SecurityError, before any
 * `getItem`. `typeof localStorage` reads the same getter, so the
 * `if (typeof localStorage === 'undefined')` guards in front of several
 * `useState` initializers threw during the first render, the error boundary
 * caught it, and the page showed "Stims crashed" instead of a visualizer.
 *
 * Each case below denies both storages the way a browser does and expects
 * the surface to come up on its defaults.
 */

const STORAGE_NAMES = ['localStorage', 'sessionStorage'] as const;

function denyStorageAccess(): () => void {
  const restores: Array<() => void> = [];
  for (const target of [globalThis, window] as object[]) {
    for (const name of STORAGE_NAMES) {
      const own = Object.getOwnPropertyDescriptor(target, name);
      Object.defineProperty(target, name, {
        configurable: true,
        get() {
          throw new DOMException(
            `Failed to read the '${name}' property from 'Window': Access is denied for this document.`,
            'SecurityError',
          );
        },
      });
      restores.push(() => {
        if (own) Object.defineProperty(target, name, own);
        else Reflect.deleteProperty(target, name);
      });
    }
  }
  return () => {
    for (const restore of restores.reverse()) restore();
  };
}

async function mount(node: React.ReactNode) {
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return {
    container,
    dispose: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

let restoreStorage: (() => void) | null = null;

beforeEach(() => {
  restoreStorage = denyStorageAccess();
});

afterEach(() => {
  restoreStorage?.();
  restoreStorage = null;
});

describe('booting with storage access denied', () => {
  test('the storage globals really throw on access in this harness', () => {
    expect(() => localStorage).toThrow('Access is denied');
    expect(() => window.sessionStorage).toThrow('Access is denied');
  });

  test('the workspace provider mounts with an empty preset queue', async () => {
    function QueueProbe() {
      const { presetQueue } = useUI();
      return <output data-queue-size="">{presetQueue.presetIds.length}</output>;
    }

    const rendered = await mount(
      <WorkspaceProvider>
        <QueueProbe />
      </WorkspaceProvider>,
    );
    try {
      expect(
        rendered.container.querySelector('[data-queue-size]')?.textContent,
      ).toBe('0');
    } finally {
      await rendered.dispose();
    }
  });

  test('a side panel opens without a remembered seam width', async () => {
    const rendered = await mount(
      <SidePanel open onClose={() => {}} title="Browse presets">
        <button type="button">inside the panel</button>
      </SidePanel>,
    );
    try {
      const dialog = rendered.container.querySelector('[role="dialog"]');
      expect(dialog?.textContent).toContain('inside the panel');
    } finally {
      await rendered.dispose();
    }
  });

  test('a draggable overlay starts at its default anchor', async () => {
    function AnchorProbe() {
      const { anchor } = useOverlayAnchor({
        storageKey: 'stims:test-anchor',
        anchors: ['left', 'right'] as const,
        defaultAnchor: 'right',
        axis: 'horizontal',
      });
      return <output data-anchor="">{anchor}</output>;
    }

    const rendered = await mount(<AnchorProbe />);
    try {
      expect(
        rendered.container.querySelector('[data-anchor]')?.textContent,
      ).toBe('right');
    } finally {
      await rendered.dispose();
    }
  });

  test('pinning a performance field works for the session', () => {
    try {
      expect(pinTarget('zoom')).toBe(true);
      expect(getPinnedTargets()).toContain('zoom');
    } finally {
      unpinTarget('zoom');
    }
  });

  test('saving shortcut overrides reports failure instead of throwing', () => {
    expect(writeShortcutOverrides({ palette: ['mod+j'] })).toBe(false);
  });

  test('WebGPU optimization flags resolve to their defaults', () => {
    expect(resolveMilkdropWebGpuOptimizationFlags({ location: null })).toEqual({
      ...DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
    });
  });

  test('the shared accessor reads nothing and reports writes as failed', () => {
    expect(readStored('stims:any')).toBeNull();
    expect(writeStored('stims:any', 'value')).toBe(false);
    expect(removeStored('stims:any')).toBe(false);
  });
});
