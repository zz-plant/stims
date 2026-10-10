import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test';
import { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { resetGrowthTelemetryForTests } from '../../src/js/core/services/preset-telemetry.ts';
import { resetTelemetryContextForTests } from '../../src/js/core/services/telemetry-context.ts';
import {
  noteFirstCodeEditAppliedOnce,
  noteFirstTuneEditAppliedOnce,
  resetFirstEditNotedForTests,
} from '../../src/js/frontend/first-edit.ts';
import { EditorPanel } from '../../src/js/milkdrop/overlay/editor-panel.ts';

/**
 * The funnel's first-edit step, finer-grained than the frozen
 * `first-edit-applied` guide button (docs/PRODUCT_MOMENTS.md, "Open one
 * up"): the first code edit the visitor typed and the first Tune control
 * they committed each fire their own growth event, once per page load.
 *
 * Two halves, both behavioral:
 *  - the panel's seam: a visitor-typed change fires onUserCodeEditApplied at
 *    the debounce that commits it; a Tune control's write fires
 *    onTuneControlCommit instead and must never fire the code event;
 *  - the once guards: two edits send one beacon, because the funnel asks
 *    whether the visitor ever edited, not how often.
 */

type Beacon = { url: string; body: Record<string, unknown> };
const pending: Promise<void>[] = [];
const flush = async () => {
  await Promise.all(pending.splice(0, pending.length));
};

let beacons: Beacon[] = [];
let originalLocation: unknown;
let originalNavigator: unknown;
let OriginalMutationObserver: typeof globalThis.MutationObserver;

beforeEach(() => {
  beacons = [];
  resetFirstEditNotedForTests();
  resetGrowthTelemetryForTests();
  resetTelemetryContextForTests();
  originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { hostname: 'toil.fyi', origin: 'https://toil.fyi' },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      sendBeacon: (url: string, blob: Blob) => {
        pending.push(
          blob.text().then((text) => {
            beacons.push({ url, body: JSON.parse(text) });
          }),
        );
        return true;
      },
    },
  });
});

afterEach(() => {
  resetFirstEditNotedForTests();
  resetTelemetryContextForTests();
  if (originalLocation) {
    Object.defineProperty(
      globalThis,
      'location',
      originalLocation as PropertyDescriptor,
    );
  } else delete (globalThis as Record<string, unknown>).location;
  if (originalNavigator) {
    Object.defineProperty(
      globalThis,
      'navigator',
      originalNavigator as PropertyDescriptor,
    );
  } else delete (globalThis as Record<string, unknown>).navigator;
});

describe('the once guards', () => {
  test('each first-edit event is sent once per page load, under its own name', async () => {
    noteFirstCodeEditAppliedOnce();
    noteFirstCodeEditAppliedOnce();
    noteFirstTuneEditAppliedOnce();
    noteFirstTuneEditAppliedOnce();
    await flush();
    expect(beacons.map((beacon) => beacon.body.event)).toEqual([
      'growth-first-code-edit-applied',
      'growth-first-tune-edit-applied',
    ]);
  });
});

describe('the panel seam', () => {
  beforeAll(() => {
    OriginalMutationObserver = globalThis.MutationObserver;
    globalThis.MutationObserver = class {
      disconnect() {}
      observe() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof MutationObserver;
  });

  afterAll(() => {
    globalThis.MutationObserver = OriginalMutationObserver;
  });

  let calls: string[];
  let panel: EditorPanel;

  const mountPanel = () => {
    calls = [];
    panel = new EditorPanel({
      onEditorSourceChange: mock(() => {
        calls.push('source-change');
      }),
      onUserCodeEditApplied: mock(() => {
        calls.push('user-code-edit');
        // The wiring under test: this is what EditorPanel.tsx passes.
        noteFirstCodeEditAppliedOnce();
      }),
      onTuneControlCommit: mock(() => {
        calls.push('tune-commit');
        noteFirstTuneEditAppliedOnce();
      }),
      onDuplicatePreset: mock(() => {}),
      onExport: mock(() => {}),
      onDeletePreset: mock(() => {}),
      onRequestImport: mock(() => {}),
      onCopyShareLink: mock(() => {}),
    });
    document.body.appendChild(panel.element);
    panel.setSessionState({
      source: 'title=Alpha\nzoom=1.000\n',
      diagnostics: [],
      latestCompiled: null,
      activeCompiled: null,
      dirty: false,
    });
  };

  const disposePanel = () => {
    panel.dispose();
    panel.element.remove();
  };

  const viewForPanel = (): EditorView => {
    const dom = panel.element.querySelector<HTMLElement>('.cm-editor');
    const view = dom ? EditorView.findFromDOM(dom) : null;
    if (!view) throw new Error('the panel did not mount its CodeMirror view');
    return view;
  };

  /** Awaits the panel's 120ms doc-commit debounce. */
  const settleCommit = async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await flush();
  };

  test('a visitor-typed edit fires the code event as it commits', async () => {
    mountPanel();
    try {
      const view = viewForPanel();
      // The transaction CodeMirror itself makes for a keystroke, annotated
      // as user input the same way its input handlers do.
      view.dispatch({
        changes: { from: view.state.doc.length, insert: 'rot=0.1\n' },
        annotations: Transaction.userEvent.of('input.type'),
      });
      await settleCommit();

      expect(calls).toEqual(['user-code-edit', 'source-change']);
      expect(beacons.map((beacon) => beacon.body.event)).toEqual([
        'growth-first-code-edit-applied',
      ]);

      // A second typed edit commits again but the session already answered.
      view.dispatch({
        changes: { from: view.state.doc.length, insert: 'warp=0.2\n' },
        annotations: Transaction.userEvent.of('input.type'),
      });
      await settleCommit();
      expect(calls.filter((call) => call === 'user-code-edit').length).toBe(2);
      expect(
        beacons.filter(
          (beacon) => beacon.body.event === 'growth-first-code-edit-applied',
        ),
      ).toHaveLength(1);
    } finally {
      disposePanel();
    }
  });

  test('a Tune control fires the tune event, never the code one', async () => {
    mountPanel();
    try {
      panel.writeVariableToEditor('zoom', 1.5);
      await settleCommit();

      expect(calls).toContain('tune-commit');
      expect(calls).not.toContain('user-code-edit');
      expect(beacons.map((beacon) => beacon.body.event)).toEqual([
        'growth-first-tune-edit-applied',
      ]);
    } finally {
      disposePanel();
    }
  });

  test('a session reload of the buffer is neither edit', async () => {
    mountPanel();
    try {
      panel.setSessionState({
        source: 'title=Beta\nzoom=1.000\n',
        diagnostics: [],
        latestCompiled: null,
        activeCompiled: null,
        dirty: false,
      });
      await settleCommit();

      expect(calls.filter((call) => call !== 'source-change')).toEqual([]);
      expect(beacons).toEqual([]);
    } finally {
      disposePanel();
    }
  });
});
