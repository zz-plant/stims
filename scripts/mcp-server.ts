import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { z } from 'zod';
import type { MilkdropExpressionNode } from '../src/js/milkdrop/common-types.ts';
import { resolveAgentChromiumArgs } from './browser-launch.ts';
import { registerPerformanceTools } from './mcp-performance-tools.ts';
import {
  asImageResponse,
  asTextResponse,
  createMcpServer,
} from './mcp-shared.ts';
import { playToy } from './play-toy.ts';
import { computeImageMetrics } from './preset-lab-metrics.ts';

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

async function closeSession(session: AgentSession) {
  try {
    await session.browser.close();
  } catch {
    /* ignore */
  }
}

const qualityGateCommands = {
  full: ['bun', ['run', 'check']],
  quick: ['bun', ['run', 'check:quick']],
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
    inputSchema: z.object({
      scope: z
        .enum(['full', 'quick', 'typecheck', 'test'])
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
    }),
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

      const summary = `Captured screenshot for ${slug} at ${result.screenshot}\nAudio Active: ${result.audioActive}\nConsole Errors: ${result.consoleErrors?.length || 0}`;
      const pngBuffer = result.screenshot
        ? await readFile(result.screenshot).catch(() => null)
        : null;
      return pngBuffer
        ? asImageResponse(pngBuffer, summary)
        : asTextResponse(summary);
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

      const summary = [
        `Preset: ${preset.title} by ${preset.author}`,
        `Screenshot: ${result.screenshot}`,
        `Audio Active: ${result.audioActive}`,
        result.consoleErrors?.length
          ? `Console Warnings: ${result.consoleErrors.length}`
          : 'No console errors',
      ].join('\n');
      const pngBuffer = result.screenshot
        ? await readFile(result.screenshot).catch(() => null)
        : null;
      return pngBuffer
        ? asImageResponse(pngBuffer, summary)
        : asTextResponse(summary);
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
      const browser = await chromium.launch({
        headless,
        args: resolveAgentChromiumArgs(),
      });
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
        const htmlDataset = document.documentElement.dataset;
        const canvas = document.querySelector('canvas');
        const overlay = document.querySelector('.milkdrop-overlay');
        const osdTitle = overlay?.querySelector('.milkdrop-overlay__osd-title');
        const osdMeta = overlay?.querySelector('.milkdrop-overlay__osd-meta');
        const dock = document.querySelector('.stims-shell__stage-dock');
        const dockStyle = dock ? getComputedStyle(dock) : null;
        const audioGlow =
          dockStyle?.getPropertyValue('--stims-audio-glow') ?? null;

        // Read audio energy from the Now Playing bar's CSS custom property
        const nowPlaying = document.querySelector(
          '.stims-shell__now-playing-bar',
        );
        const npStyle = nowPlaying ? getComputedStyle(nowPlaying) : null;
        const audioEnergy =
          npStyle?.getPropertyValue('--stims-energy') ?? audioGlow;

        return {
          page: dataset.page,
          audioActive: dataset.audioActive ?? 'false',
          audioEnergy: audioEnergy ? parseFloat(audioEnergy).toFixed(2) : null,
          backend: dataset.activeBackend ?? htmlDataset.activeBackend ?? null,
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
      'Capture a screenshot from an active agent session. Returns both the file path and the image itself (inline base64), so it works whether the client shares a filesystem with this process or not. Use after start_agent_session.',
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
      const pngBuffer = await session.page.screenshot({ path: filepath });

      return asImageResponse(
        pngBuffer,
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

// ── Agent source and settings tools ─────────────────────────────────

import { readFileSync } from 'node:fs';
import { join as pathJoin } from 'node:path';

const PRESET_DIR = pathJoin(
  import.meta.dirname ?? __dirname,
  '..',
  'public',
  'milkdrop-presets',
);

server.registerTool(
  'session_get_preset_source',
  {
    description:
      'Get the raw .milk preset source code for a specific preset. Lets agents read and understand the MilkDrop preset code that creates the visuals.',
    inputSchema: z.object({
      presetId: z
        .string()
        .describe(
          'Preset ID (e.g. "eos-ether"). Defaults to the session\'s current preset.',
        )
        .optional(),
      sessionId: z
        .string()
        .optional()
        .describe(
          'Session ID - defaults to file system lookup if not provided.',
        ),
    }),
  },
  async ({ presetId, sessionId }) => {
    let pid = presetId;
    if (!pid && sessionId) {
      const session = agentSessions.get(sessionId);
      pid = session?.presetId;
    }
    if (!pid) {
      return asTextResponse(
        'Provide a presetId or a sessionId with an active preset.',
      );
    }

    try {
      const filePath = pathJoin(PRESET_DIR, `${pid}.milk`);
      const source = readFileSync(filePath, 'utf8');
      const lines = source.split('\n');
      const summary = lines
        .slice(0, 5)
        .map((l) => l.trim())
        .filter(Boolean)
        .join('\n');
      return asTextResponse(
        `## ${pid}.milk\n${lines.length} lines\n\n\`\`\`\n${summary}\n...\n\`\`\`\n\nFull source (${lines.length} lines):\n\n\`\`\`\n${source}\n\`\`\``,
      );
    } catch {
      return asTextResponse(
        `Preset file "${pid}.milk" not found in bundled catalog.`,
      );
    }
  },
);

/**
 * Live code editing goes through the editor session's compile pipeline, which
 * deliberately keeps rendering the last good compile when new source fails.
 * That safety net is invisible from outside: the stage keeps moving whether
 * the edit landed or not. These helpers read the bridge's editor state so a
 * tool can say which of the two actually happened.
 */
type AgentEditorStatePayload = {
  presetId: string | null;
  title: string | null;
  dirty: boolean;
  errorCount: number;
  warningCount: number;
  diagnostics: Array<{
    severity: string;
    code: string;
    message: string;
    line?: number;
    field?: string;
  }>;
  renderingFallback: boolean;
  renderedTitle: string | null;
  sourceLength: number;
};

const EDITOR_BRIDGE_MISSING =
  'The page has no editor bridge. Make sure the session was started in agent mode (?agent=true) and the visualizer has finished mounting.';

function formatEditorState(
  state: AgentEditorStatePayload,
  heading: string,
): string {
  const lines = [heading];
  lines.push(
    `preset: ${state.title ?? 'unknown'} (${state.presetId ?? 'no id'})`,
  );
  lines.push(
    `compile: ${state.errorCount} error(s), ${state.warningCount} warning(s)`,
  );
  lines.push(`buffer: ${state.sourceLength} chars, dirty=${state.dirty}`);

  if (state.renderingFallback) {
    lines.push(
      '',
      `⚠ NOT RENDERING YOUR SOURCE. The compile failed, so the stage is still showing the last good compile ("${state.renderedTitle ?? 'previous preset'}"). Fix the errors below and re-apply.`,
    );
  }

  if (state.diagnostics.length) {
    lines.push('', 'diagnostics:');
    for (const diagnostic of state.diagnostics.slice(0, 25)) {
      const where = diagnostic.line ? `line ${diagnostic.line}` : 'no line';
      const field = diagnostic.field ? ` [${diagnostic.field}]` : '';
      lines.push(
        `  ${diagnostic.severity}: ${where}${field} — ${diagnostic.message} (${diagnostic.code})`,
      );
    }
    if (state.diagnostics.length > 25) {
      lines.push(`  … ${state.diagnostics.length - 25} more`);
    }
  } else {
    lines.push('', 'diagnostics: none — the source compiled clean.');
  }

  return lines.join('\n');
}

server.registerTool(
  'session_apply_source',
  {
    description:
      'Apply modified preset source code to the running visualizer and wait for it to compile. Returns real compile diagnostics with line numbers, and tells you when the source FAILED and the stage is still rendering the previous preset — a failed edit looks identical on screen otherwise. Changes are in-memory only; refresh to reset.',
    inputSchema: z.object({
      sessionId: z.string().describe('Session ID from start_agent_session.'),
      source: z
        .string()
        .describe('The full .milk preset source code to apply.'),
    }),
  },
  async ({ sessionId, source }) => {
    const session = getSession(sessionId);
    if (!session) return asTextResponse('Session not found or expired.');

    try {
      // Awaits the actual compile rather than sleeping a fixed 1500ms and
      // declaring success, which reported "applied" for source that never
      // compiled.
      const state = await session.page.evaluate(
        async (src) =>
          (await window.__STIMS_AGENT_BRIDGE__?.applyEditorSource(src)) ?? null,
        source,
      );

      if (!state) return asTextResponse(EDITOR_BRIDGE_MISSING);

      return asTextResponse(
        formatEditorState(
          state as AgentEditorStatePayload,
          (state as AgentEditorStatePayload).errorCount > 0
            ? 'Source applied but DID NOT compile.'
            : 'Source applied and compiled successfully.',
        ),
      );
    } catch (e) {
      return asTextResponse(`Error applying source: ${e}`);
    }
  },
);

server.registerTool(
  'session_editor_state',
  {
    description:
      'Read the live editor/compile state without changing anything: current preset, error and warning counts, per-line diagnostics, whether the buffer is dirty, and whether the stage is rendering a fallback because the latest source failed to compile. Use after any edit to confirm what actually landed.',
    inputSchema: z.object({
      sessionId: z.string().describe('Session ID from start_agent_session.'),
    }),
  },
  async ({ sessionId }) => {
    const session = getSession(sessionId);
    if (!session) return asTextResponse('Session not found or expired.');

    try {
      const state = await session.page.evaluate(
        () => window.__STIMS_AGENT_BRIDGE__?.getEditorState() ?? null,
      );
      if (!state) return asTextResponse(EDITOR_BRIDGE_MISSING);

      return asTextResponse(
        formatEditorState(state as AgentEditorStatePayload, 'Editor state:'),
      );
    } catch (e) {
      return asTextResponse(`Error reading editor state: ${e}`);
    }
  },
);

server.registerTool(
  'session_set_fields',
  {
    description:
      'Set several MilkDrop fields (zoom, warp, decay, wave_r, …) in ONE compile, and wait for the result. Prefer this over repeated session_midi_set calls when changing more than one field: separate calls can interleave inside a single compile window, and it returns compile diagnostics the same way session_apply_source does.',
    inputSchema: z.object({
      sessionId: z.string().describe('Session ID from start_agent_session.'),
      fields: z
        .record(z.string(), z.union([z.number(), z.string()]))
        .describe(
          'Field name to value, e.g. { "zoom": 1.02, "warp": 0.4, "wave_r": 0.9 }.',
        ),
    }),
  },
  async ({ sessionId, fields }) => {
    const session = getSession(sessionId);
    if (!session) return asTextResponse('Session not found or expired.');

    const keys = Object.keys(fields);
    if (!keys.length) return asTextResponse('No fields given.');

    try {
      const state = await session.page.evaluate(
        async (updates) =>
          (await window.__STIMS_AGENT_BRIDGE__?.applyEditorFields(updates)) ??
          null,
        fields as Record<string, number | string>,
      );
      if (!state) return asTextResponse(EDITOR_BRIDGE_MISSING);

      return asTextResponse(
        formatEditorState(
          state as AgentEditorStatePayload,
          `Applied ${keys.length} field(s) in one commit: ${keys.join(', ')}.`,
        ),
      );
    } catch (e) {
      return asTextResponse(`Error setting fields: ${e}`);
    }
  },
);

server.registerTool(
  'session_get_inspector_values',
  {
    description:
      "Read the running preset's numeric field values (zoom, warp, decay, wave_r, …) straight from the compiled IR. These are the values actually driving the render, not scraped panel markup, and no panel needs to be open. Pass a filter to narrow a large preset down.",
    inputSchema: z.object({
      sessionId: z.string().describe('Session ID from start_agent_session.'),
      filter: z
        .string()
        .optional()
        .describe(
          'Case-insensitive substring to match field names, e.g. "wave" or "mv_".',
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(2000)
        .optional()
        .default(200)
        .describe('Maximum fields to return (default 200).'),
    }),
  },
  async ({ sessionId, filter, limit }) => {
    const session = getSession(sessionId);
    if (!session) return asTextResponse('Session not found or expired.');

    try {
      // Previously this clicked open the inspector tab and read `value`
      // attributes out of the DOM, which returned the markup's *initial*
      // attribute rather than the live value and silently produced `{}` when
      // the overlay was not mounted.
      const fields = await session.page.evaluate(
        () => window.__STIMS_AGENT_BRIDGE__?.getEditorFields() ?? null,
      );
      if (!fields) return asTextResponse(EDITOR_BRIDGE_MISSING);

      const all = fields as Record<string, number>;
      const needle = filter?.toLowerCase();
      const entries = Object.entries(all)
        .filter(([key]) => !needle || key.toLowerCase().includes(needle))
        .sort(([a], [b]) => a.localeCompare(b));

      if (!entries.length) {
        return asTextResponse(
          `No fields match "${filter}". The preset defines ${Object.keys(all).length} fields.`,
        );
      }

      // The IR pre-populates every custom wave/shape slot, so an unfiltered
      // read is ~1600 mostly-default entries. Cap it and say so rather than
      // flooding the caller's context.
      const cap = limit ?? 200;
      const shown = entries.slice(0, cap);
      const header = `${shown.length} of ${entries.length} field(s)${
        filter ? ` matching "${filter}"` : ''
      } (preset defines ${Object.keys(all).length} total):`;
      const footer =
        entries.length > shown.length
          ? `\n… ${entries.length - shown.length} more omitted — narrow with \`filter\` or raise \`limit\`.`
          : '';

      return asTextResponse(
        [
          header,
          JSON.stringify(Object.fromEntries(shown), null, 2),
          footer,
        ].join('\n'),
      );
    } catch (e) {
      return asTextResponse(`Error reading fields: ${e}`);
    }
  },
);

// ── MIDI performance tools ───────────────────────────────────────────
// The app models Claude as a virtual MIDI device ("Claude (MCP)") that
// goes through the exact same per-device binding pipeline a physical
// controller uses (src/js/core/services/webmidi-controller.ts). These
// tools post window messages the app already listens for
// (src/js/frontend/agent-bridge.ts) — same mechanism session_apply_source
// uses for the editor, just a different event name.

server.registerTool(
  'session_midi_set',
  {
    description:
      'Set a MilkDrop target (zoom, warp, rot, decay, q1-q4, or any preset variable) to a specific value, as the virtual "Claude (MCP)" MIDI device. Value is in the target\'s own units (e.g. zoom=1.2), not a raw 0-127 MIDI value — use session_midi_cc for that.',
    inputSchema: z.object({
      sessionId: z.string().describe('Session ID from start_agent_session.'),
      target: z
        .string()
        .describe('Field name to set, e.g. "zoom", "warp", "q1".'),
      value: z.number().describe("Value to apply, in the target's own units."),
    }),
  },
  async ({ sessionId, target, value }) => {
    const session = getSession(sessionId);
    if (!session) return asTextResponse('Session not found or expired.');

    try {
      await session.page.evaluate(
        ({ target: t, value: v }) => {
          window.postMessage(
            { type: 'toil:midi_set', target: t, value: v },
            '*',
          );
        },
        { target, value },
      );
      return asTextResponse(`Set ${target} = ${value}.`);
    } catch (e) {
      return asTextResponse(`Error setting ${target}: ${e}`);
    }
  },
);

server.registerTool(
  'session_midi_cc',
  {
    description:
      'Send a raw MIDI Control Change value (0-127) as the virtual "Claude (MCP)" device. Resolved through whatever mapping that device currently has for the CC number — use session_midi_bindings to see current mappings, or session_midi_set to target a field by name directly.',
    inputSchema: z.object({
      sessionId: z.string().describe('Session ID from start_agent_session.'),
      cc: z.number().int().min(0).max(127).describe('MIDI CC number.'),
      value: z.number().int().min(0).max(127).describe('Raw value, 0-127.'),
    }),
  },
  async ({ sessionId, cc, value }) => {
    const session = getSession(sessionId);
    if (!session) return asTextResponse('Session not found or expired.');

    try {
      await session.page.evaluate(
        ({ cc: c, value: v }) => {
          window.postMessage({ type: 'toil:midi_cc', cc: c, value: v }, '*');
        },
        { cc, value },
      );
      return asTextResponse(`Sent CC${cc} = ${value}.`);
    } catch (e) {
      return asTextResponse(`Error sending CC${cc}: ${e}`);
    }
  },
);

server.registerTool(
  'session_midi_bindings',
  {
    description:
      'List current MIDI CC bindings for every known device (physical controllers plus the virtual "Claude (MCP)" channel), keyed by device id.',
    inputSchema: z.object({
      sessionId: z.string().describe('Session ID from start_agent_session.'),
    }),
  },
  async ({ sessionId }) => {
    const session = getSession(sessionId);
    if (!session) return asTextResponse('Session not found or expired.');

    try {
      const bindings = await session.page.evaluate(
        () => window.__STIMS_AGENT_BRIDGE__?.getMidiBindings?.() ?? {},
      );
      return asTextResponse(JSON.stringify(bindings, null, 2));
    } catch (e) {
      return asTextResponse(`Error reading MIDI bindings: ${e}`);
    }
  },
);

server.registerTool(
  'session_midi_devices',
  {
    description:
      'List known MIDI devices for the session — physical controllers (with connect state) and the virtual "Claude (MCP)" channel.',
    inputSchema: z.object({
      sessionId: z.string().describe('Session ID from start_agent_session.'),
    }),
  },
  async ({ sessionId }) => {
    const session = getSession(sessionId);
    if (!session) return asTextResponse('Session not found or expired.');

    try {
      const devices = await session.page.evaluate(
        () => window.__STIMS_AGENT_BRIDGE__?.getMidiDevices?.() ?? [],
      );
      return asTextResponse(JSON.stringify(devices, null, 2));
    } catch (e) {
      return asTextResponse(`Error reading MIDI devices: ${e}`);
    }
  },
);

// ── Vibe coding tools ───────────────────────────────────────────────

server.registerTool(
  'session_describe_frame',
  {
    description:
      'Capture a frame from the active session and return a structured description of the visuals — brightness levels, color distribution, and motion hints. Lets agents "see" what the visualizer is showing without manually inspecting screenshots.',
    inputSchema: z.object({
      sessionId: z.string().describe('Session ID from start_agent_session.'),
      waitMs: z
        .number()
        .int()
        .min(0)
        .max(5000)
        .optional()
        .default(300)
        .describe('Ms to wait before capture.'),
    }),
  },
  async ({ sessionId, waitMs }) => {
    const session = getSession(sessionId);
    if (!session) return asTextResponse('Session not found or expired.');

    try {
      if (waitMs && waitMs > 0) await session.page.waitForTimeout(waitMs);

      // Capture a screenshot and analyze it via Playwright's built-in pixel access
      const screenshotPath = `/tmp/stims-analyze-${Date.now()}.png`;
      const screenshotBuffer = await session.page.screenshot({
        path: screenshotPath,
      });

      // Basic metadata from the page
      const meta = await session.page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        const overlay = document.querySelector('.milkdrop-overlay');
        const osdTitle = overlay?.querySelector('.milkdrop-overlay__osd-title');
        const osdMeta = overlay?.querySelector('.milkdrop-overlay__osd-meta');
        return {
          width: canvas?.width ?? 0,
          height: canvas?.height ?? 0,
          presetTitle: osdTitle?.textContent?.trim() ?? null,
          presetAuthor: osdMeta?.textContent?.trim() ?? null,
        };
      });

      // Numeric image metrics (brightness, colorfulness, blown highlights,
      // near-black detection) so an agent without vision can still tell a
      // rendering apart from a black/frozen canvas. session_capture_frame
      // remains the path for actually looking at the pixels.
      const { data, info } = await sharp(screenshotBuffer)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const metrics = computeImageMetrics({
        data,
        width: info.width,
        height: info.height,
        channels: info.channels,
      });

      const analysis = {
        ...meta,
        screenshotPath,
        metrics,
        note: metrics.nearBlack
          ? 'Frame reads as near-black — likely a blank/failed render, not just a dark preset. Check session_get_state and console errors.'
          : 'Use session_capture_frame to inspect pixels directly (e.g. with a vision model) if these metrics are ambiguous.',
      };

      return asTextResponse(JSON.stringify(analysis, null, 2));
    } catch (e) {
      return asTextResponse(`Error analyzing frame: ${e}`);
    }
  },
);

server.registerTool(
  'session_vibe',
  {
    description:
      "THE VIBE CODING TOOL. Given a natural language description of what you want to see, this tool opens the visualizer, iterates through presets to find the closest match, and returns frames so you can see the result. Describe the mood, colors, energy, or style you're looking for.",
    inputSchema: z.object({
      vibe: z
        .string()
        .describe(
          'Describe what you want to see — mood, colors, energy level (e.g. "dark purple storm with bright lightning flashes").',
        ),
      durationMs: z
        .number()
        .int()
        .min(2000)
        .max(20000)
        .optional()
        .default(6000)
        .describe('How long to watch each candidate preset (ms).'),
    }),
  },
  async ({ vibe, durationMs }) => {
    try {
      const q = vibe.toLowerCase();
      const catalog = await fetch(
        'https://toil.fyi/milkdrop-presets/catalog.json',
      ).then((r) => r.json());

      // Score presets by keyword relevance to the vibe description
      const keywords = q.split(/\s+/).filter((w) => w.length > 3);
      const scored = catalog.presets
        .map(
          (p: {
            id: string;
            title: string;
            author: string;
            tags?: string[];
          }) => {
            const text = [p.title, p.author, ...(p.tags ?? [])]
              .join(' ')
              .toLowerCase();
            const score = keywords.filter((k: string) =>
              text.includes(k),
            ).length;
            return { ...p, score };
          },
        )
        .sort(
          (a: { score: number }, b: { score: number }) => b.score - a.score,
        );

      const best = scored.slice(0, 3);
      if (best.length === 0)
        return asTextResponse('No presets found matching that description.');

      // Open a session and try each candidate
      const browser = await chromium.launch({
        headless: true,
        args: resolveAgentChromiumArgs(),
      });
      const page = await browser.newPage({
        viewport: { width: 1280, height: 720 },
      });

      const results: string[] = [];
      for (const preset of best) {
        await page.goto(
          `http://localhost:5173/?agent=true&preset=${encodeURIComponent(preset.id)}`,
          { waitUntil: 'networkidle', timeout: 15000 },
        );
        await page.waitForTimeout(1000);
        const btn = page.locator('button:has-text("See visuals now")');
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false))
          await btn.click();
        await page.waitForTimeout(durationMs ?? 6000);

        const filename = `vibe-${preset.id}-${Date.now()}.png`;
        const filepath = `/tmp/${filename}`;
        await page.screenshot({ path: filepath });

        const matchReason =
          preset.score > 0
            ? `matched ${preset.score} keyword(s)`
            : 'selected as fallback';
        results.push(
          `- ${preset.title} by ${preset.author} (${matchReason}): ${filepath}`,
        );
      }

      await browser.close();

      return asTextResponse(
        [
          `Vibe search: "${vibe}"`,
          `Tried ${best.length} preset(s)`,
          '',
          ...results,
          '',
          'Use session_capture_frame with a session to capture more frames.',
        ].join('\n'),
      );
    } catch (e) {
      return asTextResponse(`Error in vibe search: ${e}`);
    }
  },
);

// ── Tweak and compare tools ─────────────────────────────────────────

server.registerTool(
  'session_tweak',
  {
    description:
      'Tweak a visual parameter in the running visualizer. Uses the inspector panel to find and modify MilkDrop fields. Describe what you want to change in natural language — the tool maps it to the right field. Examples: "more blue", "increase warp", "faster motion", "brighter".',
    inputSchema: z.object({
      sessionId: z.string().describe('Session ID from start_agent_session.'),
      tweak: z
        .string()
        .describe(
          'What to change (e.g. "more blue", "increase warp", "brighter colors").',
        ),
      amount: z
        .number()
        .optional()
        .default(0.15)
        .describe('How much to change (0-1, default 0.15).'),
    }),
  },
  async ({ sessionId, tweak, amount }) => {
    const session = getSession(sessionId);
    if (!session) return asTextResponse('Session not found or expired.');
    const tweakAmount = amount ?? 0.15;

    // Map natural language tweaks to MilkDrop fields
    const t = tweak.toLowerCase();
    const fieldMap: Array<{ match: string[]; field: string; delta: number }> = [
      {
        match: ['more blue', 'bluer', 'increase blue', 'blue shift'],
        field: 'ib_b',
        delta: tweakAmount,
      },
      {
        match: ['less blue', 'reduce blue'],
        field: 'ib_b',
        delta: -tweakAmount,
      },
      {
        match: ['more red', 'redder', 'increase red', 'red shift'],
        field: 'ib_r',
        delta: tweakAmount,
      },
      { match: ['less red', 'reduce red'], field: 'ib_r', delta: -tweakAmount },
      {
        match: ['more green', 'greener', 'increase green'],
        field: 'ib_g',
        delta: tweakAmount,
      },
      {
        match: ['less green', 'reduce green'],
        field: 'ib_g',
        delta: -tweakAmount,
      },
      {
        match: ['warmer', 'more warm', 'increase warmth'],
        field: 'ib_r',
        delta: tweakAmount,
      },
      {
        match: ['cooler', 'more cool', 'increase cool', 'cool shift'],
        field: 'ib_b',
        delta: tweakAmount,
      },
      {
        match: ['brighter', 'more bright', 'increase brightness'],
        field: 'gammaadj',
        delta: -0.05,
      },
      {
        match: ['darker', 'more dark', 'decrease brightness'],
        field: 'gammaadj',
        delta: 0.05,
      },
      {
        match: ['more warp', 'increase warp', 'more distortion', 'warp more'],
        field: 'warp',
        delta: tweakAmount,
      },
      {
        match: ['less warp', 'decrease warp', 'less distortion'],
        field: 'warp',
        delta: -tweakAmount,
      },
      {
        match: ['more zoom', 'zoom in', 'increase zoom'],
        field: 'zoom',
        delta: tweakAmount,
      },
      {
        match: ['less zoom', 'zoom out', 'decrease zoom'],
        field: 'zoom',
        delta: -tweakAmount,
      },
      {
        match: ['more motion', 'faster', 'increase motion', 'more movement'],
        field: 'mv_dx',
        delta: 0.5,
      },
      {
        match: ['less motion', 'slower', 'decrease motion'],
        field: 'mv_dx',
        delta: -0.5,
      },
      {
        match: ['more saturation', 'more colorful', 'more vibrant'],
        field: 'saturation',
        delta: tweakAmount,
      },
      {
        match: ['less saturation', 'less colorful', 'more grey'],
        field: 'saturation',
        delta: -tweakAmount,
      },
      {
        match: ['more contrast', 'increase contrast'],
        field: 'contrast',
        delta: tweakAmount,
      },
      {
        match: ['less contrast', 'decrease contrast'],
        field: 'contrast',
        delta: -tweakAmount,
      },
      {
        match: ['more decay', 'more trail', 'more smear', 'longer trail'],
        field: 'decay',
        delta: 0.02,
      },
      {
        match: ['less decay', 'shorter trail', 'crisper'],
        field: 'decay',
        delta: -0.02,
      },
      {
        match: [
          'more rot',
          'more rotation',
          'spin faster',
          'faster spin',
          'rotate more',
        ],
        field: 'rot',
        delta: 0.05,
      },
      {
        match: [
          'less rot',
          'less rotation',
          'spin slower',
          'slower spin',
          'rotate less',
        ],
        field: 'rot',
        delta: -0.05,
      },
      {
        match: ['more wave', 'bigger wave', 'increase wave', 'wave scale'],
        field: 'wave_scale',
        delta: 0.2,
      },
      {
        match: ['less wave', 'smaller wave', 'decrease wave'],
        field: 'wave_scale',
        delta: -0.2,
      },
      {
        match: [
          'more beat',
          'higher beat sensitivity',
          'more sensitive',
          'beat pulse',
        ],
        field: 'beat_sensitivity',
        delta: 0.2,
      },
      {
        match: ['less beat', 'lower beat sensitivity', 'less sensitive'],
        field: 'beat_sensitivity',
        delta: -0.2,
      },
    ];

    const updates: Record<string, number> = {};
    const changes: string[] = [];

    // Deltas are resolved against the compiled IR's real values and applied in
    // ONE commit. The previous implementation scraped the inspector panel's
    // markup, needed that panel open, and pushed "changed" while discarding
    // the {error} its own page script returned — so a field it never found
    // still reported success.
    const current = await session.page.evaluate(
      () => window.__STIMS_AGENT_BRIDGE__?.getEditorFields() ?? null,
    );
    if (!current) return asTextResponse(EDITOR_BRIDGE_MISSING);

    const fields = current as Record<string, number>;
    const missing: string[] = [];

    for (const entry of fieldMap) {
      if (!entry.match.some((m) => t.includes(m))) continue;
      const base = fields[entry.field];
      if (typeof base !== 'number' || !Number.isFinite(base)) {
        missing.push(entry.field);
        continue;
      }
      const next = Number((base + entry.delta).toFixed(4));
      updates[entry.field] = next;
      changes.push(`  ${entry.field}: ${base} → ${next}`);
    }

    if (!changes.length && !missing.length) {
      return asTextResponse(
        `Could not understand "${tweak}". Try: more/less color (red, blue, green), warp, zoom, motion, brightness, saturation, contrast, decay.`,
      );
    }

    if (!changes.length) {
      return asTextResponse(
        `Tweak "${tweak}" maps to ${missing.join(', ')}, which this preset does not define. Nothing changed.`,
      );
    }

    try {
      const state = await session.page.evaluate(
        async (u) =>
          (await window.__STIMS_AGENT_BRIDGE__?.applyEditorFields(u)) ?? null,
        updates,
      );
      if (!state) return asTextResponse(EDITOR_BRIDGE_MISSING);

      const notes = missing.length
        ? `\nnot defined by this preset (skipped): ${missing.join(', ')}`
        : '';

      return asTextResponse(
        [
          formatEditorState(
            state as AgentEditorStatePayload,
            `Applied tweak "${tweak}" in one commit:\n${changes.join('\n')}${notes}`,
          ),
          '',
          'Use session_capture_frame to see the result.',
        ].join('\n'),
      );
    } catch (e) {
      return asTextResponse(`Error applying tweak: ${e}`);
    }
  },
);

server.registerTool(
  'session_compare',
  {
    description:
      'Capture before and after frames when making visual changes. Takes a "before" screenshot, waits for changes to settle, then takes an "after" screenshot. Perfect for seeing the impact of preset tweaks.',
    inputSchema: z.object({
      sessionId: z.string().describe('Session ID from start_agent_session.'),
      settleMs: z
        .number()
        .int()
        .min(500)
        .max(10000)
        .optional()
        .default(2000)
        .describe('Ms to wait between before and after.'),
      label: z
        .string()
        .optional()
        .describe(
          'Optional label for the comparison (e.g. "after color tweak").',
        ),
    }),
  },
  async ({ sessionId, settleMs, label }) => {
    const session = getSession(sessionId);
    if (!session) return asTextResponse('Session not found or expired.');

    try {
      const ts = Date.now();
      const beforePath = `/tmp/stims-before-${ts}.png`;
      await session.page.screenshot({ path: beforePath });

      if (settleMs && settleMs > 0) await session.page.waitForTimeout(settleMs);

      const afterPath = `/tmp/stims-after-${ts}.png`;
      await session.page.screenshot({ path: afterPath });

      return asTextResponse(
        [
          `Before: ${beforePath}`,
          `After: ${afterPath}`,
          label ? `Label: ${label}` : '',
          `Settle time: ${settleMs ?? 2000}ms`,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    } catch (e) {
      return asTextResponse(`Error in comparison: ${e}`);
    }
  },
);

// ── Compiler inspection ─────────────────────────────────────────────
// The preset pipeline is source → AST → IR → lowered GPU programs, and a
// failure at any stage shows up only as "the preset looks wrong". These two
// tools expose the intermediate stages so an agent can read what the compiler
// actually produced instead of inferring it from pixels.

function formatExpressionTree(
  node: MilkdropExpressionNode,
  indent = 0,
): string[] {
  const pad = '  '.repeat(indent);
  switch (node.type) {
    case 'literal':
      return [`${pad}literal ${node.value}`];
    case 'identifier':
      return [`${pad}identifier ${node.name}`];
    case 'unary':
      return [
        `${pad}unary ${node.operator}`,
        ...formatExpressionTree(node.operand, indent + 1),
      ];
    case 'binary':
      return [
        `${pad}binary ${node.operator}`,
        ...formatExpressionTree(node.left, indent + 1),
        ...formatExpressionTree(node.right, indent + 1),
      ];
    case 'call':
      return [
        `${pad}call ${node.name}`,
        ...node.args.flatMap((arg: MilkdropExpressionNode) =>
          formatExpressionTree(arg, indent + 1),
        ),
      ];
    default:
      return [`${pad}${(node as { type: string }).type}`];
  }
}

function formatStatementTree(
  statement: import('../src/js/milkdrop/types.ts').MilkdropCompiledStatement,
  indent = 1,
): string[] {
  const pad = '  '.repeat(indent);
  const lines: string[] = [];

  if (statement.control) {
    const kind = statement.control.kind;
    lines.push(`${pad}control: ${kind}`);
    if (statement.control.kind === 'loop') {
      if (statement.control.count) {
        lines.push(`${pad}  count:`);
        lines.push(
          ...formatExpressionTree(statement.control.count, indent + 2),
        );
      }
    } else if (statement.control.condition) {
      lines.push(`${pad}  condition:`);
      lines.push(
        ...formatExpressionTree(statement.control.condition, indent + 2),
      );
    }
    lines.push(
      `${pad}  body (${statement.control.body.length} statement${statement.control.body.length === 1 ? '' : 's'}):`,
    );
    statement.control.body.forEach((sub, subIdx) => {
      lines.push(
        `${pad}    [${subIdx}] line ${sub.line}: ${sub.source.trim()}`,
      );
      lines.push(...formatStatementTree(sub, indent + 3));
    });
    return lines;
  }

  if (statement.target === '__control') {
    lines.push(`${pad}expression statement:`);
    lines.push(...formatExpressionTree(statement.expression, indent + 1));
    return lines;
  }

  lines.push(`${pad}target: ${statement.target}`);
  lines.push(...formatExpressionTree(statement.expression, indent + 1));
  return lines;
}

server.registerTool(
  'inspect_eel_ast',
  {
    description:
      'Parse MilkDrop EEL source (one or more statements, as found in a per_frame/per_pixel block) and return the parsed AST plus any parser diagnostics. Use this to check how the compiler actually reads an expression before blaming the renderer for a wrong-looking preset.',
    inputSchema: z.object({
      source: z
        .string()
        .min(1)
        .describe(
          'EEL source, e.g. "zoom = 1 + 0.1*sin(time);rot = rot + 0.01".',
        ),
      startLine: z
        .number()
        .int()
        .min(1)
        .optional()
        .default(1)
        .describe('Line number reported in diagnostics. Defaults to 1.'),
    }),
  },
  async ({ source, startLine = 1 }) => {
    const { parseMilkdropStatement, splitMilkdropStatements } = await import(
      '../src/js/milkdrop/expression.ts'
    );

    const statements = splitMilkdropStatements(source);
    if (statements.length === 0) {
      return asTextResponse('No statements parsed from the supplied source.');
    }

    const lines: string[] = [`Statements: ${statements.length}`, ''];
    let diagnosticCount = 0;

    statements.forEach((statementSource, index) => {
      const line = startLine + index;
      const parsed = parseMilkdropStatement(statementSource, line);
      lines.push(`[${index}] line ${line}: ${statementSource.trim()}`);

      if (parsed.value) {
        lines.push(...formatStatementTree(parsed.value, 1));
      } else {
        lines.push('  <unparsed>');
      }

      for (const diagnostic of parsed.diagnostics) {
        diagnosticCount += 1;
        lines.push(
          `  ${diagnostic.severity}: ${diagnostic.message} (${diagnostic.code})`,
        );
      }
      lines.push('');
    });

    lines.push(`Diagnostics: ${diagnosticCount}`);
    return asTextResponse(lines.join('\n'));
  },
);

server.registerTool(
  'inspect_preset_lowerer',
  {
    description:
      'Compile a bundled catalog preset (or a .milk file) and report what each lowering stage produced: warp/comp shader programs and their generated GLSL, WGSL for the per-frame block, whether the per-pixel block lowers to a GPU field program, shader control uniforms, and compile diagnostics. Use this to find where a preset falls off the GPU path.',
    inputSchema: z.object({
      presetId: z
        .string()
        .optional()
        .describe('Bundled catalog preset id to inspect.'),
      filePath: z
        .string()
        .optional()
        .describe('Path to a .milk file, used instead of presetId.'),
      stage: z
        .enum(['summary', 'glsl', 'wgsl', 'uniforms'])
        .optional()
        .default('summary')
        .describe(
          'summary = all stages at a glance; glsl/wgsl = emit generated shader source; uniforms = shader control values and samplers.',
        ),
    }),
  },
  async ({ presetId, filePath, stage = 'summary' }) => {
    if (!presetId && !filePath) {
      return asTextResponse('Provide either presetId or filePath.');
    }

    try {
      const [
        { loadPresetSource },
        { compileMilkdropPresetSource },
        { lowerGpuFieldProgram },
      ] = await Promise.all([
        import('./preset-lab-reactivity.ts'),
        import('../src/js/milkdrop/compiler.ts'),
        import('../src/js/milkdrop/compiler/gpu-field-planner.ts'),
      ]);

      const repoRoot = fileURLToPath(new URL('..', import.meta.url));
      const source = loadPresetSource(repoRoot, { presetId, filePath });
      const compiled = compileMilkdropPresetSource(source.raw, {
        id: source.id,
        title: source.title,
      });
      const shader = compiled.ir.shaderText;

      if (stage === 'glsl') {
        const { generateGlslFromShaderStatements } = await import(
          '../src/js/milkdrop/compiler/shader-analysis-glsl.ts'
        );
        const warpGlsl = generateGlslFromShaderStatements(
          shader.warpAst,
          'warp',
        );
        const compGlsl = generateGlslFromShaderStatements(
          shader.compAst,
          'comp',
        );
        return asTextResponse(
          [
            `Preset: ${source.id}`,
            '',
            '── warp GLSL ──',
            warpGlsl ?? '<not emitted>',
            '',
            '── comp GLSL ──',
            compGlsl ?? '<not emitted>',
          ].join('\n'),
        );
      }

      if (stage === 'wgsl') {
        const { compileProgramToWgsl } = await import(
          '../src/js/milkdrop/compiler/wgsl-generator.ts'
        );
        const perFrame = compileProgramToWgsl(compiled.ir.programs.perFrame);
        return asTextResponse(
          [
            `Preset: ${source.id}`,
            `Entry point: ${perFrame.entryPoint}`,
            `GPU executable: ${perFrame.gpuExecutable ? 'yes' : 'no'}`,
            perFrame.unsupportedFeatures.length > 0
              ? `Unsupported: ${perFrame.unsupportedFeatures.join(', ')}`
              : 'Unsupported: none',
            '',
            '── per_frame WGSL ──',
            perFrame.wgslCode,
          ].join('\n'),
        );
      }

      if (stage === 'uniforms') {
        return asTextResponse(
          [
            `Preset: ${source.id}`,
            '',
            '── shader controls ──',
            JSON.stringify(shader.controls, null, 2),
            '',
            '── custom samplers ──',
            JSON.stringify(shader.customSamplers, null, 2),
          ].join('\n'),
        );
      }

      const gpuPerPixel = lowerGpuFieldProgram(compiled.ir.programs.perPixel);
      const errors = compiled.diagnostics.filter((d) => d.severity === 'error');
      const warnings = compiled.diagnostics.filter(
        (d) => d.severity === 'warning',
      );

      const lines = [
        `Preset: ${source.id}`,
        `Title: ${compiled.title}`,
        '',
        '── shader lowering ──',
        `warp text:      ${shader.warp === null ? 'none authored' : `${shader.warp.split('\n').length} lines`}`,
        `warp program:   ${
          shader.warpProgram
            ? `${shader.warpProgram.execution.kind} → ${shader.warpProgram.execution.entryTarget} [${shader.warpProgram.execution.supportedBackends.join(', ')}]`
            : 'not lowered'
        }`,
        `comp text:      ${shader.comp === null ? 'none authored' : `${shader.comp.split('\n').length} lines`}`,
        `comp program:   ${
          shader.compProgram
            ? `${shader.compProgram.execution.kind} → ${shader.compProgram.execution.entryTarget} [${shader.compProgram.execution.supportedBackends.join(', ')}]`
            : 'not lowered'
        }`,
        `fully supported: ${shader.supported ? 'yes' : 'no'}`,
        `approximated lines: ${shader.unsupportedLines.length}`,
        '',
        '── gpu field lowering (per_pixel) ──',
        // The WebGPU field path silently falls back to the CPU transform when
        // this returns null, so "not lowered" here is the single most common
        // reason a preset costs more per frame than its author intended.
        `per_pixel statements: ${compiled.ir.programs.perPixel.statements.length}`,
        `lowered to GPU field: ${gpuPerPixel ? 'yes' : 'no'}`,
        '',
        '── diagnostics ──',
        `errors: ${errors.length}  warnings: ${warnings.length}`,
      ];

      for (const diagnostic of [...errors, ...warnings].slice(0, 25)) {
        lines.push(
          `  ${diagnostic.severity} ${diagnostic.code}${
            diagnostic.line === undefined ? '' : ` (line ${diagnostic.line})`
          }: ${diagnostic.message}`,
        );
      }
      if (errors.length + warnings.length > 25) {
        lines.push(
          `  … ${errors.length + warnings.length - 25} more not shown`,
        );
      }

      if (shader.unsupportedLines.length > 0) {
        lines.push('', '── approximated shader lines ──');
        lines.push(
          ...shader.unsupportedLines.slice(0, 15).map((l) => `  ${l}`),
        );
      }

      return asTextResponse(lines.join('\n'));
    } catch (e) {
      return asTextResponse(`Error inspecting preset: ${e}`);
    }
  },
);

// ── Live-performance tools ──────────────────────────────────────────
// Pattern the audio, ramp visuals over time, and measure the result. Kept in
// their own module; they need the session map, so getSession is passed in.
registerPerformanceTools(server, getSession);

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
