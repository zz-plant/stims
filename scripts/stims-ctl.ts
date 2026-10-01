/**
 * stims-ctl — one-shot CLI for controlling a running visualizer without an
 * MCP client. Launches a single headless (by default) browser session,
 * applies the requested actions in order, prints a JSON summary, and exits.
 *
 * Mirrors the same surfaces the MCP agent-session tools use:
 *   - preset / renderer backend: URL params (`?preset=`, `?renderer=`),
 *     since there is no live backend switch — changing it always reloads.
 *   - audio source: window.stimState.enableDemoAudio()/enableMicrophone()
 *     (src/js/core/agent-api.ts) — stable, DOM-click-backed.
 *   - field values: the `toil:midi_set` message (src/js/frontend/agent-bridge.ts),
 *     the same virtual-MIDI-device path the session_midi_set MCP tool uses;
 *     each waits for its reply.
 *   - any other `toil:*` message: --post, answered by the same bridge an
 *     embedding page uses. --embed loads the app inside an iframe on a parent
 *     page (scripts/embed-harness.ts) so those messages cross a real frame
 *     boundary, the way they do for an embedding site.
 *
 * Usage:
 *   bun run scripts/stims-ctl.ts [options]
 *
 * The summary also carries `agent`: the full `__stims_agent.getState()` snapshot
 * (engineState, presetId, catalogSize, shaderExecution, lastError, statusLog…).
 * The process exits non-zero if any --run / --wait-for step failed.
 *
 * Options:
 *   --preset <id>              Preset to load
 *   --backend <webgl|webgpu|auto>  Renderer backend (forces a fresh load)
 *   --audio <demo|microphone>  Audio source to enable
 *   --set-field <key=value>    Set a MilkDrop target (repeatable)
 *   --shortcut <id>            Trigger a keyboard shortcut by id (repeatable) —
 *                              see SHORTCUT_KEYS below for supported ids; source
 *                              of truth is src/js/frontend/shortcut-registry.ts
 *   --run <id>[=<json>]        Run a command-palette action or targeted verb via
 *                              window.__stims_agent.run (repeatable, in order),
 *                              e.g. --run next-preset
 *                                   --run 'select-preset={"id":"martin-skywards"}'
 *                              select-preset waits for the catalog and set-field
 *                              for the engine first (the API rejects them until
 *                              then). The JSON summary's `steps` has each result,
 *                              including the events the action caused.
 *   --wait-for <expr>          Wait until a JS expression over the agent state
 *                              `s` is true, e.g. --wait-for 's.catalogSize > 0'
 *                              (repeatable; runs in order with --run)
 *   --post <json>              Send a toil:* message and record its reply
 *                              (repeatable; runs in order with --run), e.g.
 *                              --post '{"type":"toil:load_preset","presetId":"geiss-casino"}'
 *   --embed                    Load the app in an iframe (?embed=true) and send
 *                              --post / --set-field from the parent page
 *   --step-timeout <ms>        Budget per --wait-for / precondition (default 15000)
 *   --screenshot <path>        Capture a PNG after all actions apply
 *   --wait <ms>                Extra wait before the final screenshot/summary
 *   --port <number>            Dev server port (default: 5173)
 *   --no-headless              Run in a visible window
 *   --timeout <ms>             Navigation/load timeout (default: 15000)
 */

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium, type Frame, type Page } from 'playwright';
import { resolveAgentChromiumArgs } from './browser-launch.ts';
import { ensureDevServer } from './dev-server.ts';
import { AUTOPLAY_ARG, openEmbedded, sendToil } from './embed-harness.ts';

type Backend = 'webgl' | 'webgpu' | 'auto';
type AudioSource = 'demo' | 'microphone';

/** One ordered action against `window.__stims_agent`. */
export type CtlStep =
  | { kind: 'run'; id: string; params?: Record<string, unknown> }
  | { kind: 'wait'; expr: string }
  | { kind: 'post'; message: Record<string, unknown> };

type CliOptions = {
  preset: string | null;
  backend: Backend | null;
  audio: AudioSource | null;
  setFields: Array<{ key: string; value: number }>;
  shortcuts: string[];
  screenshot: string | null;
  waitMs: number;
  port: number;
  headless: boolean;
  timeoutMs: number;
  steps: CtlStep[];
  stepTimeoutMs: number;
  embed: boolean;
};

/**
 * Default single-key bindings for the ids useKeyboardShortcuts.ts actually
 * matches via eventMatchesShortcut (see src/js/frontend/shortcut-registry.ts
 * and hooks/useKeyboardShortcuts.ts). Deliberately excludes 'quick-select'
 * (needs a digit + a loaded catalog, not a fixed key), 'close' (handled
 * outside this hook), and 'compile' (CodeMirror-only keybinding) — none of
 * those are reachable through a single synthetic keydown the way the rest
 * are. Duplicated here (rather than imported) because this is a standalone
 * script outside the app bundle; re-check against the registry if a
 * shortcut here stops working after a keybinding change.
 */
const SHORTCUT_KEYS: Record<string, string> = {
  audio: ' ',
  fullscreen: 'f',
  browse: 'b',
  settings: 's',
  editor: 'e',
  refine: 'g',
  visualsearch: 'm',
  shuffle: 'n',
  previous: 'p',
  favorite: 'a',
  help: '?',
};

/**
 * `next-preset` or `select-preset={"id":"x"}`. Ids never contain `=`, so the
 * first `=` splits the id from the JSON params.
 */
export function parseRunSpec(
  raw: string,
): { id: string; params?: Record<string, unknown> } | { error: string } {
  const eq = raw.indexOf('=');
  const id = (eq === -1 ? raw : raw.slice(0, eq)).trim();
  if (!id) return { error: 'expected <id> or <id>=<json params>' };
  if (eq === -1) return { id };
  try {
    const params: unknown = JSON.parse(raw.slice(eq + 1));
    if (
      params === null ||
      typeof params !== 'object' ||
      Array.isArray(params)
    ) {
      return { error: 'params must be a JSON object' };
    }
    return { id, params: params as Record<string, unknown> };
  } catch (error) {
    return { error: `params are not valid JSON (${(error as Error).message})` };
  }
}

/** A `toil:*` message as JSON: an object whose `type` names the command. */
export function parsePostSpec(
  raw: string,
): { message: Record<string, unknown> } | { error: string } {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch (error) {
    return { error: `not valid JSON (${(error as Error).message})` };
  }
  if (
    message === null ||
    typeof message !== 'object' ||
    Array.isArray(message)
  ) {
    return { error: 'expected a JSON object' };
  }
  const { type } = message as { type?: unknown };
  if (typeof type !== 'string' || !type.startsWith('toil:')) {
    return {
      error: 'type must name a toil:* command, e.g. "toil:load_preset"',
    };
  }
  return { message: message as Record<string, unknown> };
}

function printUsageAndExit(): never {
  console.error('Usage: bun run scripts/stims-ctl.ts [options]');
  console.error('Options:');
  console.error('  --preset <id>              Preset to load');
  console.error(
    '  --backend <webgl|webgpu|auto>  Renderer backend (forces a fresh load)',
  );
  console.error('  --audio <demo|microphone>  Audio source to enable');
  console.error(
    '  --set-field <key=value>    Set a MilkDrop target (repeatable)',
  );
  console.error(
    `  --shortcut <id>            Trigger a keyboard shortcut (repeatable): ${Object.keys(SHORTCUT_KEYS).join(', ')}`,
  );
  console.error(
    '  --run <id>[=<json>]        Run a palette action or verb (repeatable, ordered), e.g. --run next-preset',
  );
  console.error(
    '  --wait-for <expr>          Wait until an expression over the agent state `s` is true (repeatable)',
  );
  console.error(
    '  --post <json>              Send a toil:* message and record its reply (repeatable, ordered)',
  );
  console.error(
    '  --embed                    Load the app in an iframe and post from the parent page',
  );
  console.error(
    '  --step-timeout <ms>        Budget per --wait-for / --post / precondition (default: 15000)',
  );
  console.error(
    '  --screenshot <path>        Capture a PNG after all actions apply',
  );
  console.error(
    '  --wait <ms>                Extra wait before the final summary',
  );
  console.error('  --port <number>            Dev server port (default: 5173)');
  console.error('  --no-headless              Run in a visible window');
  console.error(
    '  --timeout <ms>             Navigation/load timeout (default: 15000)',
  );
  process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    preset: null,
    backend: null,
    audio: null,
    setFields: [],
    shortcuts: [],
    screenshot: null,
    waitMs: 0,
    port: 5173,
    headless: !argv.includes('--no-headless'),
    timeoutMs: 15000,
    steps: [],
    stepTimeoutMs: 15000,
    embed: argv.includes('--embed'),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--preset':
        options.preset = argv[++i] ?? null;
        break;
      case '--backend': {
        const value = argv[++i];
        if (value !== 'webgl' && value !== 'webgpu' && value !== 'auto') {
          console.error(
            `Invalid --backend "${value}" (expected webgl|webgpu|auto)`,
          );
          printUsageAndExit();
        }
        options.backend = value;
        break;
      }
      case '--audio': {
        const value = argv[++i];
        if (value !== 'demo' && value !== 'microphone') {
          console.error(
            `Invalid --audio "${value}" (expected demo|microphone)`,
          );
          printUsageAndExit();
        }
        options.audio = value;
        break;
      }
      case '--set-field': {
        const raw = argv[++i] ?? '';
        const eq = raw.indexOf('=');
        if (eq === -1) {
          console.error(`Invalid --set-field "${raw}" (expected key=value)`);
          printUsageAndExit();
        }
        const key = raw.slice(0, eq);
        const value = Number.parseFloat(raw.slice(eq + 1));
        if (!key || Number.isNaN(value)) {
          console.error(`Invalid --set-field "${raw}" (expected key=value)`);
          printUsageAndExit();
        }
        options.setFields.push({ key, value });
        break;
      }
      case '--shortcut': {
        const id = argv[++i] ?? '';
        if (!SHORTCUT_KEYS[id]) {
          console.error(
            `Invalid --shortcut "${id}" (expected one of: ${Object.keys(SHORTCUT_KEYS).join(', ')})`,
          );
          printUsageAndExit();
        }
        options.shortcuts.push(id);
        break;
      }
      case '--run': {
        const raw = argv[++i] ?? '';
        const spec = parseRunSpec(raw);
        if ('error' in spec) {
          console.error(`Invalid --run "${raw}": ${spec.error}`);
          printUsageAndExit();
        }
        options.steps.push({ kind: 'run', ...spec });
        break;
      }
      case '--wait-for': {
        const expr = (argv[++i] ?? '').trim();
        if (!expr) {
          console.error(
            'Invalid --wait-for: expected a JS expression over `s`',
          );
          printUsageAndExit();
        }
        options.steps.push({ kind: 'wait', expr });
        break;
      }
      case '--post': {
        const raw = argv[++i] ?? '';
        const spec = parsePostSpec(raw);
        if ('error' in spec) {
          console.error(`Invalid --post "${raw}": ${spec.error}`);
          printUsageAndExit();
        }
        options.steps.push({ kind: 'post', message: spec.message });
        break;
      }
      case '--embed':
        break;
      case '--step-timeout':
        options.stepTimeoutMs =
          Number.parseInt(argv[++i] ?? '15000', 10) || 15000;
        break;
      case '--screenshot':
        options.screenshot = argv[++i] ?? null;
        break;
      case '--wait':
        options.waitMs = Number.parseInt(argv[++i] ?? '0', 10) || 0;
        break;
      case '--port':
        options.port = Number.parseInt(argv[++i] ?? '5173', 10) || 5173;
        break;
      case '--timeout':
        options.timeoutMs = Number.parseInt(argv[++i] ?? '15000', 10) || 15000;
        break;
      case '--no-headless':
        break;
      case '--help':
      case '-h':
        printUsageAndExit();
        break;
      default:
        console.error(`Unknown option "${arg}"`);
        printUsageAndExit();
    }
  }

  return options;
}

type StepResult = {
  kind: CtlStep['kind'];
  ok: boolean;
  [key: string]: unknown;
};

/**
 * Runs one step inside the page against `window.__stims_agent`. Push-based
 * (`waitFor` wakes on each state commit), so nothing here sleeps.
 */
async function executeStep(
  page: Page,
  app: Frame,
  step: CtlStep,
  timeoutMs: number,
  embedded: boolean,
): Promise<StepResult> {
  if (step.kind === 'post') {
    const reply = await sendToil(page, step.message, { embedded, timeoutMs });
    return {
      kind: 'post',
      message: step.message,
      // toil:telemetry is data rather than an outcome, so it has no success.
      ok: reply.type === 'toil:telemetry' || reply.success === true,
      error: reply.success === false ? reply.reason : undefined,
      reply,
    };
  }
  if (step.kind === 'wait') {
    return app.evaluate(
      async ({ expr, timeoutMs }) => {
        const agent = window.__stims_agent;
        if (!agent) {
          return {
            kind: 'wait' as const,
            expr,
            ok: false,
            error: 'window.__stims_agent is not installed (needs ?agent=true).',
          };
        }
        let predicate: (state: unknown) => unknown;
        try {
          predicate = new Function('s', `return (${expr});`) as never;
        } catch (error) {
          return {
            kind: 'wait' as const,
            expr,
            ok: false,
            error: `invalid expression: ${(error as Error).message}`,
          };
        }
        try {
          await agent.waitFor((state) => Boolean(predicate(state)), timeoutMs);
          return { kind: 'wait' as const, expr, ok: true };
        } catch (error) {
          return {
            kind: 'wait' as const,
            expr,
            ok: false,
            error: (error as Error).message,
          };
        }
      },
      { expr: step.expr, timeoutMs },
    );
  }
  return app.evaluate(
    async ({ id, params, timeoutMs }) => {
      const agent = window.__stims_agent;
      if (!agent) {
        return {
          kind: 'run' as const,
          id,
          ok: false,
          error: 'window.__stims_agent is not installed (needs ?agent=true).',
        };
      }
      // The API rejects these until their precondition holds; waiting here is
      // what a caller would otherwise have to script by hand.
      if (id === 'select-preset') {
        await agent
          .waitFor((s) => s.catalogSize > 0, timeoutMs)
          .catch(() => {});
      }
      if (id === 'set-field') {
        await agent.waitFor((s) => s.engineReady, timeoutMs).catch(() => {});
      }
      const result = await agent.run(id, params);
      return { kind: 'run' as const, id, params, ...result };
    },
    { id: step.id, params: step.params, timeoutMs },
  );
}

async function run(options: CliOptions) {
  const server = await ensureDevServer(options.port);
  const browser = await chromium.launch({
    headless: options.headless,
    args: [...resolveAgentChromiumArgs(), AUTOPLAY_ARG],
  });

  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });

    const url = new URL(`http://127.0.0.1:${options.port}/`);
    url.searchParams.set('agent', 'true');
    if (options.embed) url.searchParams.set('embed', 'true');
    if (options.preset) url.searchParams.set('preset', options.preset);
    if (options.backend) url.searchParams.set('renderer', options.backend);

    // The frame holding the app: the page itself, or the embed iframe.
    let app: Frame;
    if (options.embed) {
      app = await openEmbedded(page, url.toString(), options.timeoutMs);
      await app
        .waitForFunction(() => Boolean(window.__STIMS_AGENT_BRIDGE__), {
          timeout: options.timeoutMs,
        })
        .catch(() => {});
    } else {
      await page.goto(url.toString(), {
        waitUntil: 'networkidle',
        timeout: options.timeoutMs,
      });
      app = page.mainFrame();
    }

    // An embedded page mounts nothing until a command asks for a preset or
    // audio, so there is no load to wait for before the steps run; null
    // records that nothing was waited on.
    let loaded: boolean | null = null;
    if (!options.embed) {
      const launchBtn = app.locator('button:has-text("See visuals now")');
      if (await launchBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await launchBtn.click();
      }
      loaded = await app
        .waitForFunction(
          () => window.stimState?.getState().toyLoaded === true,
          { timeout: options.timeoutMs },
        )
        .then(() => true)
        .catch(() => false);
    }
    if (loaded === false) {
      console.error(
        `Warning: toy did not report loaded within ${options.timeoutMs}ms — continuing anyway.`,
      );
    }

    if (options.audio) {
      await app.evaluate((source) => {
        const api = window.stimState;
        if (!api) throw new Error('window.stimState is not available.');
        return source === 'demo'
          ? api.enableDemoAudio()
          : api.enableMicrophone();
      }, options.audio);
    }

    const fieldResults: StepResult[] = [];
    for (const field of options.setFields) {
      fieldResults.push(
        await executeStep(
          page,
          app,
          {
            kind: 'post',
            message: {
              type: 'toil:midi_set',
              target: field.key,
              value: field.value,
            },
          },
          options.stepTimeoutMs,
          options.embed,
        ),
      );
    }

    for (const id of options.shortcuts) {
      const key = SHORTCUT_KEYS[id];
      await app.evaluate((k) => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: k,
            bubbles: true,
            cancelable: true,
          }),
        );
      }, key);
      await page.waitForTimeout(150);
    }

    const stepResults: StepResult[] = [];
    for (const step of options.steps) {
      stepResults.push(
        await executeStep(
          page,
          app,
          step,
          options.stepTimeoutMs,
          options.embed,
        ),
      );
    }

    if (options.waitMs > 0) {
      await page.waitForTimeout(options.waitMs);
    }

    if (options.screenshot) {
      await mkdir(dirname(options.screenshot), { recursive: true });
      await page.screenshot({ path: options.screenshot });
    }

    const summary = await app.evaluate(() => ({
      state: window.stimState?.getState() ?? null,
      agent: window.__stims_agent?.getState() ?? null,
      backend: document.body.dataset.activeBackend ?? null,
      midiBindings: window.__STIMS_AGENT_BRIDGE__?.getMidiBindings?.() ?? null,
    }));
    const rendererString = await app
      .evaluate(() => {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        if (!gl) return null;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        return String(gl.getParameter(param));
      })
      .catch(() => null);

    console.log(
      JSON.stringify(
        {
          ...summary,
          rendererString,
          toyLoaded: loaded,
          screenshot: options.screenshot,
          embedded: options.embed,
          fieldsSet: fieldResults,
          shortcutsTriggered: options.shortcuts,
          steps: stepResults,
        },
        null,
        2,
      ),
    );
    const failed = [...fieldResults, ...stepResults].filter(
      (result) => !result.ok,
    );
    for (const result of failed) {
      const label =
        result.kind === 'run'
          ? `--run ${String(result.id)}`
          : result.kind === 'wait'
            ? `--wait-for ${String(result.expr)}`
            : `--post ${JSON.stringify(result.message)}`;
      console.error(`Step failed: ${label}: ${String(result.error)}`);
    }
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  await run(options);
}

export { parseArgs, run };
