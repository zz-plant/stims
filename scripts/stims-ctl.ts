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
 * Options:
 *   --preset <id>              Preset to load
 *   --backend <webgl|webgpu|auto>  Renderer backend (forces a fresh load)
 *   --audio <demo|microphone>  Audio source to enable
 *   --set-field <key=value>    Set a MilkDrop target (repeatable)
 *   --shortcut <id>            Trigger a keyboard shortcut by id (repeatable) —
 *                              see SHORTCUT_KEYS below for supported ids; source
 *                              of truth is src/js/frontend/shortcut-registry.ts
 *   --screenshot <path>        Capture a PNG after all actions apply
 *   --wait <ms>                Extra wait before the final screenshot/summary
 *   --port <number>            Dev server port (default: 5173)
 *   --no-headless              Run in a visible window
 *   --timeout <ms>             Navigation/load timeout (default: 15000)
 */

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from 'playwright';
import { ensureDevServer } from './dev-server.ts';

type Backend = 'webgl' | 'webgpu' | 'auto';
type AudioSource = 'demo' | 'microphone';

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

async function run(options: CliOptions) {
  const server = await ensureDevServer(options.port);
  const browser = await chromium.launch({ headless: options.headless });

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

    if (options.waitMs > 0) {
      await page.waitForTimeout(options.waitMs);
    }

    if (options.screenshot) {
      await mkdir(dirname(options.screenshot), { recursive: true });
      await page.screenshot({ path: options.screenshot });
    }

    const summary = await page.evaluate(() => ({
      state: window.stimState?.getState() ?? null,
      backend: document.body.dataset.activeBackend ?? null,
      midiBindings: window.__STIMS_AGENT_BRIDGE__?.getMidiBindings?.() ?? null,
    }));

    console.log(
      JSON.stringify(
        {
          ...summary,
          toyLoaded: loaded,
          screenshot: options.screenshot,
          fieldsSet: options.setFields,
          shortcutsTriggered: options.shortcuts,
        },
        null,
        2,
      ),
    );
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
