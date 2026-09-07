import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import {
  isShaderBranchDesugarEnabled,
  setShaderBranchDesugarEnabled,
} from '../../src/js/milkdrop/compiler/shader-branch-desugar.ts';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import { createMilkdropEditorSession } from '../../src/js/milkdrop/editor-session.ts';
import type { MilkdropPresetSource } from '../../src/js/milkdrop/types.ts';

describe('milkdrop editor session', () => {
  let OriginalWorker: typeof Worker;
  let workerCreations = 0;

  class DefaultMockWorker {
    private messageListener: ((event: MessageEvent) => void) | null = null;

    constructor() {
      workerCreations += 1;
    }

    addEventListener(type: string, listener: (...args: unknown[]) => void) {
      if (type === 'message') {
        this.messageListener = listener as (event: MessageEvent) => void;
      }
    }

    removeEventListener() {}

    postMessage(message: unknown) {
      const msg = message as {
        type?: string;
        path?: string[];
        argumentList: { value: unknown }[];
        id?: string;
      } | null;
      if (msg && msg.type === 'APPLY' && msg.path?.[0] === 'compile') {
        const source = msg.argumentList[0].value as string;
        const preset = msg.argumentList[1]
          .value as Partial<MilkdropPresetSource>;
        try {
          const compiled = compileMilkdropPresetSource(source, preset);
          setTimeout(() => {
            this.messageListener?.({
              data: {
                id: msg.id,
                type: 'RAW',
                value: compiled,
              },
            } as MessageEvent);
          }, 0);
        } catch (_err) {
          setTimeout(() => {
            this.messageListener?.({
              data: {
                id: msg.id,
                type: 'RAW',
                value: compileMilkdropPresetSource(source, preset),
              },
            } as MessageEvent);
          }, 0);
        }
      }
    }

    terminate() {}
  }

  beforeAll(() => {
    OriginalWorker = globalThis.Worker;
  });

  afterAll(() => {
    globalThis.Worker = OriginalWorker;
  });

  beforeEach(() => {
    workerCreations = 0;
    globalThis.Worker = DefaultMockWorker as unknown as typeof Worker;
  });

  test('loads presets through the compile worker', async () => {
    // Preset loads happen mid-playback: compiling them on the main thread
    // stalls the running visual (measured in seconds on mobile), so
    // loadPreset uses the worker like applySource does. Session creation
    // itself stays worker-free — the initial preset is compiled inline.
    const session = createMilkdropEditorSession({
      initialPreset: {
        id: 'editor-load-worker',
        title: 'Editor Load Worker',
        raw: 'title=Editor Load Worker\nwave_r=0.4\n',
        origin: 'user',
      },
    });
    expect(workerCreations).toBe(0);

    const loaded = await session.loadPreset({
      id: 'editor-load-worker-2',
      title: 'Editor Load Worker 2',
      raw: 'title=Editor Load Worker 2\nwave_g=0.5\n',
      origin: 'bundled',
    });

    expect(workerCreations).toBe(1);
    expect(loaded.activeCompiled?.ir.numericFields.wave_g).toBeCloseTo(0.5, 6);

    await session.applySource('title=Editor Load Worker 2\nwave_g=0.75\n');
    expect(workerCreations).toBe(1);

    session.dispose();
  });

  test('compiles worker presets under the session branch-desugar setting', async () => {
    // The desugar is a module-level boolean, and the compile worker is its own
    // module instance: it defaults to "off" no matter what the page resolved.
    // Before the session pushed the setting across, every preset loaded while
    // ?milkdrop-webgpu-branch-desugar=1 was set came back classified
    // `translated` — the uniform-only approximation — because the worker that
    // compiled it had never heard of the flag.
    //
    // WorkerWithOwnDesugarState models that separation: it holds its own copy
    // of the setting, starts it off, and compiles with that copy swapped in.
    let workerDesugar = false;
    const settingsReceived: boolean[] = [];

    class WorkerWithOwnDesugarState extends DefaultMockWorker {
      postMessage(message: unknown) {
        const msg = message as {
          type?: string;
          path?: string[];
          argumentList: { value: unknown }[];
        } | null;
        if (
          msg &&
          msg.type === 'APPLY' &&
          msg.path?.[0] === 'setShaderBranchDesugar'
        ) {
          workerDesugar = msg.argumentList[0].value as boolean;
          settingsReceived.push(workerDesugar);
          return;
        }
        const pageDesugar = isShaderBranchDesugarEnabled();
        setShaderBranchDesugarEnabled(workerDesugar);
        try {
          super.postMessage(message);
        } finally {
          setShaderBranchDesugarEnabled(pageDesugar);
        }
      }
    }

    const branching = [
      'MILKDROP_PRESET_VERSION=201',
      'PSVERSION=2',
      '[preset00]',
      'warp=1.0',
      'comp_1=shader_body {',
      'comp_2=float3 c = tex2D(sampler_main, uv).xyz;',
      'comp_3=if (c.x > 0.5) { c = float3(1,0,0); } else { c = float3(0,0,1); }',
      'comp_4=ret = c;',
      'comp_5=}',
      '',
    ].join('\n');

    const pageDesugar = isShaderBranchDesugarEnabled();
    globalThis.Worker = WorkerWithOwnDesugarState as unknown as typeof Worker;
    setShaderBranchDesugarEnabled(true);
    try {
      const session = createMilkdropEditorSession({
        initialPreset: {
          id: 'desugar-session',
          title: 'Desugar Session',
          raw: 'title=Desugar Session\nwave_r=0.4\n',
          origin: 'user',
        },
      });

      const loaded = await session.loadPreset({
        id: 'desugar-session-branching',
        title: 'Desugar Session Branching',
        raw: branching,
        origin: 'bundled',
      });

      expect(settingsReceived).toEqual([true]);
      expect(
        loaded.activeCompiled?.ir.compatibility.featureAnalysis
          .shaderTextExecution.webgpu,
      ).toBe('direct');

      session.dispose();
    } finally {
      setShaderBranchDesugarEnabled(pageDesugar);
    }
  });

  test('leaves worker presets approximated when the desugar is off', async () => {
    // The flag has to stay a real gate: with it off the branching body is
    // still unparseable and the backend still approximates it.
    let workerDesugar = false;

    class WorkerWithOwnDesugarState extends DefaultMockWorker {
      postMessage(message: unknown) {
        const msg = message as {
          type?: string;
          path?: string[];
          argumentList: { value: unknown }[];
        } | null;
        if (
          msg &&
          msg.type === 'APPLY' &&
          msg.path?.[0] === 'setShaderBranchDesugar'
        ) {
          workerDesugar = msg.argumentList[0].value as boolean;
          return;
        }
        const pageDesugar = isShaderBranchDesugarEnabled();
        setShaderBranchDesugarEnabled(workerDesugar);
        try {
          super.postMessage(message);
        } finally {
          setShaderBranchDesugarEnabled(pageDesugar);
        }
      }
    }

    const branching = [
      'MILKDROP_PRESET_VERSION=201',
      'PSVERSION=2',
      '[preset00]',
      'warp=1.0',
      'comp_1=shader_body {',
      'comp_2=float3 c = tex2D(sampler_main, uv).xyz;',
      'comp_3=if (c.x > 0.5) { c = float3(1,0,0); } else { c = float3(0,0,1); }',
      'comp_4=ret = c;',
      'comp_5=}',
      '',
    ].join('\n');

    const pageDesugar = isShaderBranchDesugarEnabled();
    globalThis.Worker = WorkerWithOwnDesugarState as unknown as typeof Worker;
    setShaderBranchDesugarEnabled(false);
    try {
      const session = createMilkdropEditorSession({
        initialPreset: {
          id: 'desugar-session-off',
          title: 'Desugar Session Off',
          raw: 'title=Desugar Session Off\nwave_r=0.4\n',
          origin: 'user',
        },
      });

      const loaded = await session.loadPreset({
        id: 'desugar-session-off-branching',
        title: 'Desugar Session Off Branching',
        raw: branching,
        origin: 'bundled',
      });

      expect(
        loaded.activeCompiled?.ir.compatibility.featureAnalysis
          .shaderTextExecution.webgpu,
      ).toBe('translated');

      session.dispose();
    } finally {
      setShaderBranchDesugarEnabled(pageDesugar);
    }
  });

  test('keeps the last good preset active when new source has errors', async () => {
    const session = createMilkdropEditorSession({
      initialPreset: {
        id: 'editor-session-test',
        title: 'Editor Session Test',
        raw: 'title=Editor Session Test\nwave_r=0.4\n',
        origin: 'user',
      },
    });

    const firstState = session.getState();
    expect(firstState.activeCompiled?.title).toBe('Editor Session Test');

    const broken = await session.applySource(
      'title=Editor Session Test\nwave_r=bad(\n',
    );
    expect(
      broken.diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
    ).toBe(true);
    expect(broken.activeCompiled?.title).toBe('Editor Session Test');
    expect(broken.activeCompiled?.ir.numericFields.wave_r).toBeCloseTo(0.4, 6);

    const repaired = await session.updateField('wave_r', 0.75);
    expect(
      repaired.diagnostics.some(
        (diagnostic) => diagnostic.severity === 'error',
      ),
    ).toBe(false);
    expect(repaired.activeCompiled?.ir.numericFields.wave_r).toBeCloseTo(
      0.75,
      6,
    );

    const structured = await session.updateField('wavecode_0_enabled', 1);
    expect(structured.activeCompiled?.ir.customWaves.length).toBe(1);
    expect(structured.activeCompiled?.ir.customWaves[0]?.fields.enabled).toBe(
      1,
    );

    session.dispose();
  });

  test('loads presets into a clean editor state before any user edits', async () => {
    const session = createMilkdropEditorSession({
      initialPreset: {
        id: 'editor-load-clean',
        title: 'Editor Load Clean',
        raw: 'title=Editor Load Clean\nwave_r=0.4\n',
        origin: 'user',
      },
    });

    const loaded = await session.loadPreset({
      id: 'editor-load-clean-2',
      title: 'Editor Load Clean 2',
      raw: 'title=Editor Load Clean 2\nwave_g=0.5\n',
      origin: 'bundled',
    });
    const formattedSource = loaded.activeCompiled?.formattedSource;

    expect(loaded.dirty).toBe(false);
    expect(formattedSource).toBeDefined();
    if (!formattedSource) {
      throw new Error('Expected the loaded preset to compile successfully.');
    }
    expect(loaded.source).toBe(formattedSource);

    session.dispose();
  });

  test('ignores stale worker commits after a newer preset load', async () => {
    const postedMessages: Array<unknown> = [];
    let messageListeners: Array<(event: MessageEvent<unknown>) => void> = [];

    globalThis.Worker = class {
      addEventListener(type: string, listener: (event: Event) => void) {
        if (type === 'message') {
          messageListeners.push(
            listener as unknown as (event: MessageEvent<unknown>) => void,
          );
        }
      }

      removeEventListener(type: string, listener: (event: Event) => void) {
        if (type !== 'message') {
          return;
        }
        messageListeners = messageListeners.filter(
          (candidate) =>
            candidate !==
            (listener as unknown as (event: MessageEvent<unknown>) => void),
        );
      }

      postMessage(payload: unknown) {
        // Only compiles are of interest here; the session also pushes its
        // branch-desugar setting across, and that message answers nothing.
        const path = (payload as { path?: string[] } | null)?.path;
        if (path?.[0] !== 'compile') {
          return;
        }
        postedMessages.push(payload);
      }

      terminate() {}
    } as unknown as typeof Worker;

    const session = createMilkdropEditorSession({
      initialPreset: {
        id: 'stale-commit-a',
        title: 'Stale Commit A',
        raw: 'title=Stale Commit A\nwave_r=0.4\n',
        origin: 'user',
      },
    });

    const pendingDraft = session.applySource(
      'title=Stale Commit A\nwave_r=0.75\n',
    );
    for (let tick = 0; tick < 20 && postedMessages.length === 0; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(postedMessages).toHaveLength(1);

    const loaded = await session.loadPreset({
      id: 'stale-commit-b',
      title: 'Stale Commit B',
      raw: 'title=Stale Commit B\nwave_g=0.5\n',
      origin: 'bundled',
    });
    expect(loaded.activeCompiled?.title).toBe('Stale Commit B');

    const workerPayload = postedMessages[0];
    if (!workerPayload) {
      throw new Error('Expected a pending worker payload.');
    }

    const wp = workerPayload as {
      argumentList: { value: unknown }[];
      id?: string;
    };

    const compiled = compileMilkdropPresetSource(
      wp.argumentList[0].value as string,
      wp.argumentList[1].value as Partial<MilkdropPresetSource>,
    );
    [...messageListeners].forEach((listener) =>
      listener({
        data: {
          id: wp.id,
          type: 'RAW',
          value: compiled,
        },
      } as MessageEvent<unknown>),
    );

    // The superseded draft commit resolves with whatever state was current
    // when it was discarded — with loadPreset compiling through the (hung)
    // worker too, that can be the pre-load snapshot. What matters is that
    // the stale reply never overwrites the newer preset in session state.
    await pendingDraft;
    const finalState = session.getState();
    expect(finalState.activeCompiled?.title).toBe('Stale Commit B');
    if (!finalState.activeCompiled) {
      throw new Error('Expected the latest preset to stay compiled.');
    }
    expect(finalState.source).toBe(finalState.activeCompiled.formattedSource);

    session.dispose();
  });
});

/**
 * Live editing is a concurrency problem wearing a text editor's clothes: a
 * 120ms debounce plus MIDI/knob nudges means several compiles are routinely in
 * flight against one worker, and every one of them must either land or be
 * cleanly superseded. These cover the failure modes that strand the editor —
 * promises that never settle, workers that leak, and edits that vanish.
 */
describe('milkdrop editor session under concurrent load', () => {
  let OriginalWorker: typeof Worker;

  beforeAll(() => {
    OriginalWorker = globalThis.Worker;
  });

  afterAll(() => {
    globalThis.Worker = OriginalWorker;
  });

  type WorkerRequest = {
    id: string;
    source: string;
    preset: Partial<MilkdropPresetSource>;
    respond: () => void;
  };

  type WorkerRig = {
    requests: WorkerRequest[];
    created: number;
    terminated: number;
    live: () => number;
    respondToAll: () => void;
  };

  /** Installs a Worker whose replies this test drives by hand, so a compile can
   * be held mid-flight for as long as the scenario needs. */
  function installControllableWorker({
    autoRespond = false,
  }: {
    autoRespond?: boolean;
  } = {}): WorkerRig {
    const rig: WorkerRig = {
      requests: [],
      created: 0,
      terminated: 0,
      live: () => rig.created - rig.terminated,
      respondToAll: () => {
        const pending = rig.requests.splice(0, rig.requests.length);
        pending.forEach((request) => request.respond());
      },
    };

    globalThis.Worker = class {
      private listeners = new Set<(event: MessageEvent<unknown>) => void>();
      private alive = true;

      constructor() {
        rig.created += 1;
      }

      addEventListener(type: string, listener: (event: Event) => void) {
        if (type === 'message') {
          this.listeners.add(
            listener as unknown as (event: MessageEvent<unknown>) => void,
          );
        }
      }

      removeEventListener(type: string, listener: (event: Event) => void) {
        if (type === 'message') {
          this.listeners.delete(
            listener as unknown as (event: MessageEvent<unknown>) => void,
          );
        }
      }

      postMessage(payload: unknown) {
        const message = payload as {
          type?: string;
          path?: string[];
          id: string;
          argumentList?: { value: unknown }[];
        };
        if (message?.type !== 'APPLY' || message.path?.[0] !== 'compile') {
          return;
        }
        const source = message.argumentList?.[0]?.value as string;
        const preset = message.argumentList?.[1]
          ?.value as Partial<MilkdropPresetSource>;
        const request: WorkerRequest = {
          id: message.id,
          source,
          preset,
          respond: () => {
            if (!this.alive) return;
            const compiled = compileMilkdropPresetSource(source, preset);
            [...this.listeners].forEach((listener) =>
              listener({
                data: { id: message.id, type: 'RAW', value: compiled },
              } as MessageEvent<unknown>),
            );
          },
        };
        rig.requests.push(request);
        if (autoRespond) {
          setTimeout(() => {
            rig.requests = rig.requests.filter(
              (candidate) => candidate !== request,
            );
            request.respond();
          }, 0);
        }
      }

      terminate() {
        // A terminated worker abandons its in-flight replies, exactly as the
        // real one does — this is what strands un-watchdogged compiles.
        this.alive = false;
        this.listeners.clear();
        rig.terminated += 1;
      }
    } as unknown as typeof Worker;

    return rig;
  }

  /** Fails loudly instead of hanging the suite when a promise never settles. */
  async function settleWithin<T>(
    promise: Promise<T>,
    ms: number,
    label: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} never settled (waited ${ms}ms)`)),
        ms,
      );
    });
    try {
      return await Promise.race([promise, guard]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const tick = (ms = 0) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const basePreset = (
    overrides: Partial<MilkdropPresetSource> = {},
  ): MilkdropPresetSource => ({
    id: 'pressure-base',
    title: 'Pressure Base',
    raw: 'title=Pressure Base\nwave_r=0.4\nwave_g=0.4\n',
    origin: 'user',
    ...overrides,
  });

  test('a stalled worker cannot strand a concurrently queued compile', async () => {
    installControllableWorker();
    const session = createMilkdropEditorSession({
      initialPreset: basePreset(),
      compileTimeoutMs: 25,
    });

    // First edit brings the worker up; the second rides the same worker while
    // the first is still unanswered.
    const first = session.applySource('title=Pressure Base\nwave_r=0.5\n');
    await tick();
    const second = session.applySource('title=Pressure Base\nwave_r=0.6\n');

    const settled = await settleWithin(
      Promise.all([first, second]),
      1500,
      'concurrent compiles against a stalled worker',
    );

    expect(settled).toHaveLength(2);
    // The newest edit must still be what the editor ends up holding.
    expect(
      session.getState().activeCompiled?.ir.numericFields.wave_r,
    ).toBeCloseTo(0.6, 6);

    session.dispose();
  });

  test('recovers on the next edit after a worker watchdog fires', async () => {
    const rig = installControllableWorker();
    const session = createMilkdropEditorSession({
      initialPreset: basePreset(),
      compileTimeoutMs: 25,
    });

    await settleWithin(
      session.applySource('title=Pressure Base\nwave_r=0.5\n'),
      1500,
      'stalled compile',
    );
    expect(rig.terminated).toBeGreaterThan(0);

    // The dead worker must not poison later edits.
    const recovered = await settleWithin(
      (async () => {
        const pending = session.applySource(
          'title=Pressure Base\nwave_r=0.9\n',
        );
        for (let attempt = 0; attempt < 40 && !rig.requests.length; attempt++) {
          await tick();
        }
        rig.respondToAll();
        return pending;
      })(),
      1500,
      'compile after watchdog recovery',
    );

    expect(recovered.activeCompiled?.ir.numericFields.wave_r).toBeCloseTo(
      0.9,
      6,
    );

    session.dispose();
  });

  test('rapid edits share a single compile worker', async () => {
    const rig = installControllableWorker({ autoRespond: true });
    const session = createMilkdropEditorSession({
      initialPreset: basePreset(),
      compileTimeoutMs: 250,
    });

    await settleWithin(
      Promise.all([
        session.applySource('title=Pressure Base\nwave_r=0.51\n'),
        session.applySource('title=Pressure Base\nwave_r=0.52\n'),
        session.applySource('title=Pressure Base\nwave_r=0.53\n'),
      ]),
      1500,
      'burst of edits',
    );

    expect(rig.created).toBe(1);

    session.dispose();
    expect(rig.live()).toBe(0);
  });

  test('disposing mid-compile settles the pending edit instead of hanging', async () => {
    installControllableWorker();
    const session = createMilkdropEditorSession({
      initialPreset: basePreset(),
      compileTimeoutMs: 5000,
    });

    const pending = session.applySource('title=Pressure Base\nwave_r=0.7\n');
    await tick();
    session.dispose();

    const settled = await settleWithin(
      pending,
      1000,
      'edit pending at dispose time',
    );
    expect(settled).toBeDefined();
  });

  test('falls back to the main thread when the worker cannot be constructed', async () => {
    globalThis.Worker = class {
      constructor() {
        throw new Error('Worker blocked by content security policy');
      }
    } as unknown as typeof Worker;

    const session = createMilkdropEditorSession({
      initialPreset: basePreset(),
      compileTimeoutMs: 250,
    });

    const applied = await settleWithin(
      session.applySource('title=Pressure Base\nwave_r=0.8\n'),
      1500,
      'edit with an unconstructable worker',
    );
    expect(applied.activeCompiled?.ir.numericFields.wave_r).toBeCloseTo(0.8, 6);

    // A blocked worker is a permanent condition; the editor should stop paying
    // the construction cost on every keystroke.
    const again = await settleWithin(
      session.applySource('title=Pressure Base\nwave_r=0.85\n'),
      1500,
      'second edit with an unconstructable worker',
    );
    expect(again.activeCompiled?.ir.numericFields.wave_r).toBeCloseTo(0.85, 6);

    session.dispose();
  });

  test('loading a preset that fails to compile keeps that preset in the editor', async () => {
    installControllableWorker({ autoRespond: true });
    const session = createMilkdropEditorSession({
      initialPreset: basePreset({
        id: 'previous-preset',
        title: 'Previous Preset',
        raw: 'title=Previous Preset\nwave_r=0.4\n',
      }),
      compileTimeoutMs: 250,
    });

    const loaded = await session.loadPreset({
      id: 'broken-preset',
      title: 'Broken Preset',
      raw: 'title=Broken Preset\nper_frame_1=wave_r = bad(\n',
      origin: 'user',
    });

    expect(
      loaded.diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
    ).toBe(true);
    // The editor must show the preset the user actually asked for, otherwise
    // the broken source is unreachable and unfixable.
    expect(loaded.source).toContain('Broken Preset');
    expect(loaded.source).not.toContain('Previous Preset');

    session.dispose();
  });

  test('interleaved field nudges do not drop earlier values', async () => {
    installControllableWorker({ autoRespond: true });
    const session = createMilkdropEditorSession({
      initialPreset: basePreset(),
      compileTimeoutMs: 250,
    });

    // Two knobs moved inside one debounce window — the classic MIDI/keyboard
    // nudge pattern. Both must survive.
    const [, second] = await settleWithin(
      Promise.all([
        session.updateField('wave_r', 0.25),
        session.updateField('wave_g', 0.75),
      ]),
      1500,
      'interleaved field nudges',
    );

    expect(second.activeCompiled?.ir.numericFields.wave_g).toBeCloseTo(0.75, 6);
    expect(second.activeCompiled?.ir.numericFields.wave_r).toBeCloseTo(0.25, 6);

    session.dispose();
  });

  test('updateFields applies a whole knob group atomically', async () => {
    installControllableWorker({ autoRespond: true });
    const session = createMilkdropEditorSession({
      initialPreset: basePreset(),
      compileTimeoutMs: 250,
    });

    const updated = await settleWithin(
      session.updateFields({ wave_r: 0.1, wave_g: 0.2, wave_b: 0.3 }),
      1500,
      'grouped field update',
    );

    expect(updated.activeCompiled?.ir.numericFields.wave_r).toBeCloseTo(0.1, 6);
    expect(updated.activeCompiled?.ir.numericFields.wave_g).toBeCloseTo(0.2, 6);
    expect(updated.activeCompiled?.ir.numericFields.wave_b).toBeCloseTo(0.3, 6);

    session.dispose();
  });

  test('an in-flight compile is attributed to the preset it started on', async () => {
    const rig = installControllableWorker();
    const session = createMilkdropEditorSession({
      initialPreset: basePreset({ id: 'preset-a', title: 'Preset A' }),
      compileTimeoutMs: 250,
    });

    const pending = session.applySource('title=Preset A\nwave_r=0.5\n');
    // Swap presets while the first compile is still resolving its worker.
    const loaded = session.loadPreset({
      id: 'preset-b',
      title: 'Preset B',
      raw: 'title=Preset B\nwave_g=0.5\n',
      origin: 'bundled',
    });

    // Both the draft edit and the preset load compile through the worker;
    // each request must stay attributed to the preset it started on.
    for (let attempt = 0; attempt < 40 && rig.requests.length < 2; attempt++) {
      await tick();
    }
    expect(rig.requests).toHaveLength(2);
    expect(rig.requests[0]?.preset.id).toBe('preset-a');
    expect(rig.requests[1]?.preset.id).toBe('preset-b');

    rig.respondToAll();
    await settleWithin(
      Promise.all([pending, loaded]),
      1500,
      'preset swap during compile',
    );
    expect(session.getState().activeCompiled?.title).toBe('Preset B');

    session.dispose();
  });

  test('calls after dispose are inert rather than throwing', async () => {
    const rig = installControllableWorker({ autoRespond: true });
    const session = createMilkdropEditorSession({
      initialPreset: basePreset(),
      compileTimeoutMs: 250,
    });

    session.dispose();
    const after = await settleWithin(
      session.applySource('title=Pressure Base\nwave_r=0.99\n'),
      1000,
      'edit after dispose',
    );

    expect(after).toBeDefined();
    expect(rig.created).toBe(0);
  });
});
