import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { chromium } from 'playwright';
import { z } from 'zod';
import { asTextResponse, createMcpServer } from './mcp-shared.ts';
import { playToy } from './play-toy.ts';

const server = createMcpServer();
const transport = new StdioServerTransport();

// ── Agent session manager ───────────────────────────────────────────
// Keeps a headless browser session alive across tool calls so agents
// can interact with a running visualizer (switch presets, capture
// frames, watch changes) the same way a human would.

type AgentSession = {
  id: string;
  browser: import('playwright').Browser;
  page: import('playwright').Page;
  presetId: string;
  createdAt: number;
  lastUsedAt: number;
  screenshotDir: string;
};

const agentSessions = new Map<string, AgentSession>();
const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 min idle timeout
const CAPTURE_DIR = mkdtempSync(join(tmpdir(), 'stims-agent-'));

/**
 * Get a session by ID, checking expiry.
 */
function getSession(sessionId: string): AgentSession | null {
  const session = agentSessions.get(sessionId);
  if (!session) return null;
  if (Date.now() - session.lastUsedAt > SESSION_TIMEOUT_MS) {
    closeSession(session);
    agentSessions.delete(sessionId);
    return null;
  }
  session.lastUsedAt = Date.now();
  return session;
}

const qualityGateCommands = {
  full: ['bun', ['run', 'check']],
  quick: ['bun', ['run', 'check:quick']],
  toys: ['bun', ['run', 'check:toys']],
  typecheck: ['bun', ['run', 'typecheck']],
  test: ['bun', ['run', 'test']],
} as const;

type QualityGateScope = keyof typeof qualityGateCommands;

const defaultQualityGateTimeoutMs = 10 * 60 * 1000;

function resolveQualityGateCommand(scope: QualityGateScope = 'full') {
  const [command, args] = qualityGateCommands[scope];

  return {
    scope,
    command,
    args,
    printableCommand: [command, ...args].join(' '),
  };
}

async function runCommand(
  command: string,
  args: readonly string[],
  timeoutMs = defaultQualityGateTimeoutMs,
  killGraceMs = 1000,
  spawnProcess: typeof spawn = spawn,
) {
  return await new Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }>((resolve) => {
    const child = spawnProcess(command, [...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let settled = false;
    let timedOut = false;
    let timeoutMessage: string | null = null;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    const finalize = (result: {
      exitCode: number | null;
      stdout?: string;
      stderr?: string;
      timedOut: boolean;
    }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) {
        clearTimeout(killTimer);
      }

      const normalizedStderr = result.stderr ?? stderrChunks.join('').trim();
      const stderr = timeoutMessage
        ? [normalizedStderr, timeoutMessage].filter(Boolean).join('\n\n')
        : normalizedStderr;

      resolve({
        exitCode: result.exitCode,
        stdout: result.stdout ?? stdoutChunks.join('').trim(),
        stderr,
        timedOut,
      });
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      timeoutMessage = `Command timed out after ${timeoutMs}ms; sent SIGTERM.`;

      child.kill('SIGTERM');

      killTimer = setTimeout(() => {
        timeoutMessage = `${timeoutMessage} Escalated to SIGKILL after ${killGraceMs}ms.`;
        child.kill('SIGKILL');
      }, killGraceMs);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(String(chunk));
    });

    child.stderr.on('data', (chunk) => {
      stderrChunks.push(String(chunk));
    });

    child.on('error', (error) => {
      finalize({
        exitCode: null,
        stderr: `${stderrChunks.join('').trim()}\n${error}`.trim(),
        timedOut,
      });
    });

    child.on('close', (exitCode) => {
      finalize({
        exitCode,
        timedOut,
      });
    });
  });
}

// Register automation tools that require Node/Bun (not compatible with Worker)
server.registerTool(
  'run_quality_gate',
  {
    description:
      'Run Bun-based quality gate commands and return structured pass/fail output. Useful for agent workflows that need deterministic repository checks.',
    inputSchema: z
      .object({
        scope: z
          .enum(['full', 'quick', 'toys', 'typecheck', 'test'])
          .optional()
          .default('full')
          .describe('Quality gate scope to run. Defaults to full.'),
        timeoutMs: z
          .number()
          .int()
          .min(1000)
          .max(30 * 60 * 1000)
          .optional()
          .default(defaultQualityGateTimeoutMs)
          .describe('Timeout in milliseconds before command termination.'),
      })
      .strict(),
  },
  async ({ scope = 'full', timeoutMs = defaultQualityGateTimeoutMs }) => {
    const selected = resolveQualityGateCommand(scope);
    const result = await runCommand(selected.command, selected.args, timeoutMs);
    const passed = result.exitCode === 0 && !result.timedOut;

    const responseLines = [
      `Scope: ${selected.scope}`,
      `Command: ${selected.printableCommand}`,
      `Status: ${passed ? 'PASS' : 'FAIL'}`,
      `Exit code: ${result.exitCode ?? 'unknown'}`,
      `Timed out: ${result.timedOut ? 'yes' : 'no'}`,
    ];

    if (result.stdout) {
      responseLines.push('', 'stdout:', result.stdout);
    }

    if (result.stderr) {
      responseLines.push('', 'stderr:', result.stderr);
    }

    return asTextResponse(responseLines.join('\n'));
  },
);

server.registerTool(
  'capture_toy_screenshot',
  {
    description:
      'Launch a toy in a headless browser, enable audio, and capture a screenshot. Useful for verifying visual output.',
    inputSchema: z.object({
      slug: z.string().describe('The toy slug to capture'),
      duration: z
        .number()
        .optional()
        .default(3000)
        .describe('Duration in ms to wait before captioning'),
    }),
  },
  async ({ slug, duration }) => {
    try {
      const result = await playToy({
        slug,
        duration,
        screenshot: true,
      });

      if (!result.success) {
        return asTextResponse(
          `Failed to capture screenshot for ${slug}: ${result.error}`,
        );
      }

      return asTextResponse(
        `Captured screenshot for ${slug} at ${result.screenshot}\nAudio Active: ${result.audioActive}\nConsole Errors: ${result.consoleErrors?.length || 0}`,
      );
    } catch (e) {
      return asTextResponse(`Error running automation: ${e}`);
    }
  },
);

server.registerTool(
  'capture_preset',
  {
    description:
      'Open the visualizer with a specific bundled preset, wait for it to render, and return a screenshot. Lets agents see what a preset looks like visually.',
    inputSchema: z.object({
      presetId: z
        .string()
        .describe(
          'The preset ID to capture (e.g. "eos-glowsticks-v2-03-music").',
        ),
      duration: z
        .number()
        .optional()
        .default(5000)
        .describe('Duration in ms to wait for the preset to render.'),
    }),
  },
  async ({ presetId, duration }) => {
    try {
      const catalog = await fetch(
        'https://toil.fyi/milkdrop-presets/catalog.json',
      ).then((r) => r.json());
      const preset = catalog.presets.find(
        (p: { id: string }) => p.id === presetId,
      );
      if (!preset) {
        return asTextResponse(
          `Preset "${presetId}" not found. Use list_presets to see available presets.`,
        );
      }

      const result = await playToy({
        slug: 'milkdrop',
        presetId,
        duration,
        screenshot: true,
      });

      if (!result.success) {
        return asTextResponse(
          `Failed to capture "${preset.title}": ${result.error}`,
        );
      }

      return asTextResponse(
        [
          `Preset: ${preset.title} by ${preset.author}`,
          `Screenshot: ${result.screenshot}`,
          `Audio Active: ${result.audioActive}`,
          result.consoleErrors?.length
            ? `Console Warnings: ${result.consoleErrors.length}`
            : 'No console errors',
        ].join('\n'),
      );
    } catch (e) {
      return asTextResponse(`Error capturing preset: ${e}`);
    }
  },
);

server.registerTool(
  'preview_gallery',
  {
    description:
      'Capture screenshots of multiple presets in sequence. Great for getting a quick visual overview of what presets look like.',
    inputSchema: z.object({
      query: z
        .string()
        .optional()
        .describe('Optional search query to filter which presets to capture.'),
      count: z
        .number()
        .int()
        .min(1)
        .max(6)
        .optional()
        .default(4)
        .describe('Number of presets to capture (1-6, default 4).'),
      duration: z
        .number()
        .optional()
        .default(4000)
        .describe('Duration in ms per preset.'),
    }),
  },
  async ({ query, count, duration }) => {
    try {
      const catalog = await fetch(
        'https://toil.fyi/milkdrop-presets/catalog.json',
      ).then((r) => r.json());

      let presets = catalog.presets;
      if (query) {
        const q = query.toLowerCase();
        presets = presets.filter(
          (p: { title: string; author: string; tags?: string[] }) =>
            p.title.toLowerCase().includes(q) ||
            p.author.toLowerCase().includes(q) ||
            p.tags?.some((t: string) => t.toLowerCase().includes(q)),
        );
      }

      const toCapture = presets.slice(0, count ?? 4);
      const results: string[] = [];

      for (const preset of toCapture) {
        const result = await playToy({
          slug: 'milkdrop',
          presetId: preset.id,
          duration,
          screenshot: true,
        });

        const line = result.success
          ? `✅ ${preset.title}: ${result.screenshot}`
          : `❌ ${preset.title}: ${result.error}`;
        results.push(line);
      }

      return asTextResponse(
        [
          `Captured ${results.length}/${toCapture.length} preset(s)`,
          ...(query ? [`Filter: "${query}"`] : []),
          '',
          ...results,
        ].join('\n'),
      );
    } catch (e) {
      return asTextResponse(`Error in gallery capture: ${e}`);
    }
  },
);

server.registerTool(
  'test_toy_interactivity',
  {
    description:
      'Run a full interactivity test on a toy: launch, check load state, enable audio, and verify active state.',
    inputSchema: z.object({
      slug: z.string().describe('The toy slug to test'),
    }),
  },
  async ({ slug }) => {
    try {
      const result = await playToy({
        slug,
        duration: 5000,
        screenshot: false,
      });

      if (result.success && result.audioActive) {
        return asTextResponse(
          `✅ Test Passed for ${slug}: Toy loaded and audio activated successfully.`,
        );
      } else {
        return asTextResponse(
          `❌ Test Failed for ${slug}\nSuccess: ${result.success}\nAudio Active: ${result.audioActive}\nError: ${result.error || 'Unknown'}\nConsole Errors: ${JSON.stringify(result.consoleErrors)}`,
        );
      }
    } catch (e) {
      return asTextResponse(`Error running test: ${e}`);
    }
  },
);

server.registerTool(
  'get_toy_health',
  {
    description:
      'Check if a specific toy loads and renders correctly without errors. Returns a health status.',
    inputSchema: z.object({
      slug: z.string().describe('The toy slug to check'),
    }),
  },
  async ({ slug }) => {
    try {
      const result = await playToy({
        slug,
        duration: 2000,
        screenshot: false,
      });

      if (
        result.success &&
        !result.error &&
        (!result.consoleErrors || result.consoleErrors.length === 0)
      ) {
        return asTextResponse(`HEALTHY: ${slug}`);
      } else {
        return asTextResponse(
          `UNHEALTHY: ${slug}\nError: ${result.error}\nConsole Errors: ${JSON.stringify(result.consoleErrors)}`,
        );
      }
    } catch (e) {
      return asTextResponse(`Error checking health: ${e}`);
    }
  },
);

// ── Agent session tools ─────────────────────────────────────────────

server.registerTool(
  'start_agent_session',
  {
    description:
      'Open the visualizer in a persistent headless browser session and return a session ID. Use this session ID with session_capture_frame, session_switch_preset, session_get_state, and session_watch to interact with a running visualizer across multiple tool calls — the same way a human would browse presets.',
    inputSchema: z.object({
      presetId: z
        .string()
        .optional()
        .default('eos-glowsticks-v2-03-music')
        .describe('Initial preset to load. Defaults to Glowsticks.'),
      headless: z
        .boolean()
        .optional()
        .default(true)
        .describe('Run headless (no visible window).'),
    }),
  },
  async ({ presetId, headless }) => {
    try {
      const id = randomUUID();
      const browser = await chromium.launch({ headless });
      const page = await browser.newPage({
        viewport: { width: 1280, height: 720 },
      });

      await page.goto(
        `http://localhost:5173/?agent=true&preset=${encodeURIComponent(presetId ?? 'eos-glowsticks-v2-03-music')}`,
        { waitUntil: 'networkidle', timeout: 15000 },
      );
      await page.waitForTimeout(1000);

      // Click launch button if present
      const launchBtn = page.locator('button:has-text("See visuals now")');
      if (await launchBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await launchBtn.click();
      }
      await page.waitForTimeout(4000);

      const session: AgentSession = {
        id,
        browser,
        page,
        presetId: presetId ?? 'eos-glowsticks-v2-03-music',
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        screenshotDir: CAPTURE_DIR,
      };
      agentSessions.set(id, session);

      return asTextResponse(
        [
          `Session started: ${id}`,
          `Preset: ${presetId ?? 'eos-glowsticks-v2-03-music'}`,
          `Screenshots: ${CAPTURE_DIR}`,
          `Available tools: session_get_state, session_capture_frame, session_switch_preset, session_watch, session_close`,
        ].join('\n'),
      );
    } catch (e) {
      return asTextResponse(`Failed to start session: ${e}`);
    }
  },
);

server.registerTool(
  'session_get_state',
  {
    description:
      'Get the current state of an active agent session — which preset is playing, the audio energy level, FPS, and backend (WebGL/WebGPU).',
    inputSchema: z.object({
      sessionId: z.string().describe('Session ID from start_agent_session.'),
    }),
  },
  async ({ sessionId }) => {
    const session = getSession(sessionId);
    if (!session) {
      return asTextResponse(
        'Session not found or expired. Start a new session with start_agent_session.',
      );
    }

    try {
      const state = await session.page.evaluate(() => {
        const body = document.body;
        const dataset = body.dataset;
        const canvas = document.querySelector('canvas');
        const overlay = document.querySelector('.milkdrop-overlay');
        const osdTitle = overlay?.querySelector('.milkdrop-overlay__osd-title');
        const osdMeta = overlay?.querySelector('.milkdrop-overlay__osd-meta');

        return {
          page: dataset.page,
          audioActive: dataset.audioActive,
          canvasExists: !!canvas,
          canvasWidth: canvas?.width,
          canvasHeight: canvas?.height,
          overlayVisible: overlay?.classList.contains('is-open') ?? false,
          presetTitle: osdTitle?.textContent?.trim() ?? null,
          presetAuthor: osdMeta?.textContent?.trim() ?? null,
          url: window.location.href,
        };
      });

      return asTextResponse(JSON.stringify(state, null, 2));
    } catch (e) {
      return asTextResponse(`Error reading session state: ${e}`);
    }
  },
);

server.registerTool(
  'session_capture_frame',
  {
    description:
      'Capture a screenshot from an active agent session. Returns the file path to the captured image. Use after start_agent_session.',
    inputSchema: z.object({
      sessionId: z.string().describe('Session ID from start_agent_session.'),
      waitMs: z
        .number()
        .int()
        .min(0)
        .max(10000)
        .optional()
        .default(500)
        .describe(
          'Additional ms to wait before capturing (for animations to settle).',
        ),
    }),
  },
  async ({ sessionId, waitMs }) => {
    const session = getSession(sessionId);
    if (!session) {
      return asTextResponse('Session not found or expired.');
    }

    try {
      if (waitMs && waitMs > 0) {
        await session.page.waitForTimeout(waitMs);
      }

      const filename = `frame-${session.presetId}-${Date.now()}.png`;
      const filepath = join(session.screenshotDir, filename);
      await session.page.screenshot({ path: filepath });

      return asTextResponse(
        `Frame captured: ${filepath}\nPreset: ${session.presetId}`,
      );
    } catch (e) {
      return asTextResponse(`Error capturing frame: ${e}`);
    }
  },
);

server.registerTool(
  'session_switch_preset',
  {
    description:
      'Load a different preset in an active agent session. Waits for the new preset to render before returning.',
    inputSchema: z.object({
      sessionId: z.string().describe('Session ID from start_agent_session.'),
      presetId: z
        .string()
        .describe('Preset ID to load (e.g. "shifter-snakeskin").'),
      waitMs: z
        .number()
        .int()
        .min(500)
        .max(15000)
        .optional()
        .default(4000)
        .describe('Ms to wait for the new preset to render.'),
    }),
  },
  async ({ sessionId, presetId, waitMs }) => {
    const session = getSession(sessionId);
    if (!session) {
      return asTextResponse('Session not found or expired.');
    }

    try {
      // Navigate to new preset
      const url = new URL(session.page.url());
      url.searchParams.set('preset', presetId);
      await session.page.goto(url.toString(), {
        waitUntil: 'networkidle',
        timeout: 15000,
      });
      await session.page.waitForTimeout(waitMs ?? 4000);

      session.presetId = presetId;

      return asTextResponse(
        `Switched to preset: ${presetId}\nReady. Use session_capture_frame to capture the visual.`,
      );
    } catch (e) {
      return asTextResponse(`Error switching preset: ${e}`);
    }
  },
);

server.registerTool(
  'session_watch',
  {
    description:
      'Watch the visualizer in an active session for N seconds. Captures frames at intervals so an agent can observe how the visual changes over time with the audio.',
    inputSchema: z.object({
      sessionId: z.string().describe('Session ID from start_agent_session.'),
      durationMs: z
        .number()
        .int()
        .min(1000)
        .max(30000)
        .optional()
        .default(5000)
        .describe('Total duration to watch (ms).'),
      intervalMs: z
        .number()
        .int()
        .min(500)
        .max(10000)
        .optional()
        .default(1000)
        .describe('Interval between frames (ms).'),
    }),
  },
  async ({ sessionId, durationMs, intervalMs }) => {
    const session = getSession(sessionId);
    if (!session) {
      return asTextResponse('Session not found or expired.');
    }

    try {
      const totalFrames = Math.floor(
        (durationMs ?? 5000) / (intervalMs ?? 1000),
      );
      const frames: string[] = [];
      const stateSnapshots: string[] = [];

      for (let i = 0; i < totalFrames; i++) {
        await session.page.waitForTimeout(intervalMs ?? 1000);

        const filename = `watch-${session.presetId}-${Date.now()}.png`;
        const filepath = join(session.screenshotDir, filename);
        await session.page.screenshot({ path: filepath });
        frames.push(filepath);

        const state = await session.page.evaluate(() => {
          const osdTitle = document.querySelector(
            '.milkdrop-overlay__osd-title',
          );
          return {
            title: osdTitle?.textContent?.trim() ?? null,
          };
        });
        stateSnapshots.push(
          `  t=${(i + 1) * (intervalMs ?? 1000)}ms: "${state.title}"`,
        );
      }

      return asTextResponse(
        [
          `Watched for ${durationMs}ms (${totalFrames} frames)`,
          `Preset: ${session.presetId}`,
          'Sequence:',
          ...stateSnapshots,
          '',
          `Frames: ${frames.join(', ')}`,
        ].join('\n'),
      );
    } catch (e) {
      return asTextResponse(`Error during watch: ${e}`);
    }
  },
);

server.registerTool(
  'session_close',
  {
    description:
      'Close an active agent session and release the browser. Always call this when done to free resources.',
    inputSchema: z.object({
      sessionId: z.string().describe('Session ID from start_agent_session.'),
    }),
  },
  async ({ sessionId }) => {
    const session = agentSessions.get(sessionId);
    if (!session) {
      return asTextResponse('Session not found or already closed.');
    }

    await closeSession(session);
    agentSessions.delete(sessionId);

    return asTextResponse('Session closed.');
  },
);

async function startServer() {
  await server.connect(transport);
  console.error('Stim Webtoys MCP server is running on stdio.');
}

if (import.meta.main) {
  await startServer();
}

export * from './mcp-shared.ts';
export {
  defaultQualityGateTimeoutMs,
  resolveQualityGateCommand,
  runCommand,
  startServer,
};
