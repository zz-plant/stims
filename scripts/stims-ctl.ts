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
 *   - field values: window.postMessage({ type: 'toil:midi_set', ... })
 *     (src/js/frontend/agent-bridge.ts), the same virtual-MIDI-device path
 *     the session_midi_set MCP tool uses.
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
 *   --step-timeout <ms>        Budget per --wait-for / precondition (default 15000)
 *   --screenshot <path>        Capture a PNG after all actions apply
 *   --wait <ms>                Extra wait before the final screenshot/summary
 *   --port <number>            Dev server port (default: 5173)
 *   --no-headless              Run in a visible window
 *   --timeout <ms>             Navigation/load timeout (default: 15000)
 */

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium, type Page } from 'playwright';
import { resolveAgentChromiumArgs } from './browser-launch.ts';
import { ensureDevServer } from './dev-server.ts';

type Backend = 'webgl' | 'webgpu' | 'auto';
type AudioSource = 'demo' | 'microphone';

/** One ordered action against `window.__stims_agent`. */
export type CtlStep =
  | { kind: 'run'; id: string; params?: Record<string, unknown> }
  | { kind: 'wait'; expr: string };

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
    '  --step-timeout <ms>        Budget per --wait-for / precondition (default: 15000)',
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

type StepResult = { kind: 'run' | 'wait'; ok: boolean; [key: string]: unknown };

/**
 * Runs one step inside the page against `window.__stims_agent`. Push-based
 * (`waitFor` wakes on each state commit), so nothing here sleeps.
 */
async function executeStep(
  page: Page,
  step: CtlStep,
  timeoutMs: number,
): Promise<StepResult> {
  if (step.kind === 'wait') {
    return page.evaluate(
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
  return page.evaluate(
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
    args: resolveAgentChromiumArgs(),
  });

  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });

    const url = new URL(`http://127.0.0.1:${options.port}/`);
    url.searchParams.set('agent', 'true');
    if (options.preset) url.searchParams.set('preset', options.preset);
    if (options.backend) url.searchParams.set('renderer', options.backend);

    await page.goto(url.toString(), {
      waitUntil: 'networkidle',
      timeout: options.timeoutMs,
    });

    const launchBtn = page.locator('button:has-text("See visuals now")');
    if (await launchBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await launchBtn.click();
    }

    const loaded = await page
      .waitForFunction(() => window.stimState?.getState().toyLoaded === true, {
        timeout: options.timeoutMs,
      })
      .then(() => true)
      .catch(() => false);
    if (!loaded) {
      console.error(
        `Warning: toy did not report loaded within ${options.timeoutMs}ms — continuing anyway.`,
      );
    }

    if (options.audio) {
      await page.evaluate((source) => {
        const api = window.stimState;
        if (!api) throw new Error('window.stimState is not available.');
        return source === 'demo'
          ? api.enableDemoAudio()
          : api.enableMicrophone();
      }, options.audio);
    }

    for (const field of options.setFields) {
      await page.evaluate(({ key, value }) => {
        window.postMessage({ type: 'toil:midi_set', target: key, value }, '*');
      }, field);
      await page.waitForTimeout(150);
    }

    for (const id of options.shortcuts) {
      const key = SHORTCUT_KEYS[id];
      await page.evaluate((k) => {
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
      stepResults.push(await executeStep(page, step, options.stepTimeoutMs));
    }

    if (options.waitMs > 0) {
      await page.waitForTimeout(options.waitMs);
    }

    if (options.screenshot) {
      await mkdir(dirname(options.screenshot), { recursive: true });
      await page.screenshot({ path: options.screenshot });
    }

    const summary = await page.evaluate(() => ({
      state: window.stimState?.getState() ?? null,
      agent: window.__stims_agent?.getState() ?? null,
      backend: document.body.dataset.activeBackend ?? null,
      midiBindings: window.__STIMS_AGENT_BRIDGE__?.getMidiBindings?.() ?? null,
    }));
    const rendererString = await page
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
          fieldsSet: options.setFields,
          shortcutsTriggered: options.shortcuts,
          steps: stepResults,
        },
        null,
        2,
      ),
    );
    const failed = stepResults.filter((result) => !result.ok);
    for (const result of failed) {
      console.error(
        `Step failed: ${result.kind === 'run' ? `--run ${String(result.id)}` : `--wait-for ${String(result.expr)}`}: ${String(result.error)}`,
      );
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
