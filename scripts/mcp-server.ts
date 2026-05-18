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

server.registerTool(
  'session_apply_source',
  {
    description:
      'Apply modified preset source code to the running visualizer. The editor panel will update and the preset will recompile and render immediately. Changes are in-memory only — refresh the page to reset.',
    inputSchema: z.object({
      sessionId: z.string().describe('Session ID from start_agent_session.'),
      source: z
        .string()
        .describe('The full .milk preset source code to apply.'),
      lineOffset: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(0)
        .describe('Line offset if applying a partial edit.'),
    }),
  },
  async ({ sessionId, source }) => {
    const session = getSession(sessionId);
    if (!session) return asTextResponse('Session not found or expired.');

    try {
      await session.page.evaluate((src) => {
        // Dispatch a custom event that the overlay's editor listens for
        window.dispatchEvent(
          new CustomEvent('applyPresetSource', { detail: src }),
        );
      }, source);
      await session.page.waitForTimeout(1500);

      return asTextResponse(
        'Source applied. The visualizer should now reflect the changes.',
      );
    } catch (e) {
      return asTextResponse(`Error applying source: ${e}`);
    }
  },
);

server.registerTool(
  'session_get_inspector_values',
  {
    description:
      'Read current MilkDrop field values from the inspector panel. Returns all visible field names and their current numeric values.',
    inputSchema: z.object({
      sessionId: z.string().describe('Session ID from start_agent_session.'),
    }),
  },
  async ({ sessionId }) => {
    const session = getSession(sessionId);
    if (!session) return asTextResponse('Session not found or expired.');

    try {
      const fields = await session.page.evaluate(() => {
        const overlay = document.querySelector('.milkdrop-overlay');
        if (!overlay) return { error: 'overlay not found' };

        // Open inspector tab if needed
        const inspectBtn = overlay.querySelector<HTMLButtonElement>(
          '[data-tab="inspector"]',
        );
        inspectBtn?.click();

        // Wait a beat for the inspector to render
        return new Promise((resolve) => {
          setTimeout(() => {
            const fieldEls = overlay.querySelectorAll(
              '.milkdrop-overlay__field',
            );
            const result: Record<string, string> = {};
            fieldEls.forEach((el) => {
              const labelEl = el.querySelector(
                '.milkdrop-overlay__field-label',
              );
              const label = labelEl?.textContent?.trim() ?? '';
              const value =
                el.querySelector('input, select')?.getAttribute('value') ?? '';
              if (label) result[label] = value;
            });
            resolve(result);
          }, 500);
        });
      });

      return asTextResponse(JSON.stringify(fields, null, 2));
    } catch (e) {
      return asTextResponse(`Error reading inspector: ${e}`);
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
      await session.page.screenshot({ path: screenshotPath });

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

      // For pixel-level analysis, agents should use session_capture_frame
      // and interpret the image themselves or via a vision model.
      const analysis = {
        ...meta,
        screenshotPath,
        note: 'Pixel data extracted to screenshot. Use a vision model or external tool for detailed analysis.',
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
      const browser = await chromium.launch({ headless: true });
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

    // Map natural language tweaks to MilkDrop fields
    const t = tweak.toLowerCase();
    const fieldMap: Array<{ match: string[]; field: string; delta: number }> = [
      {
        match: ['more blue', 'bluer', 'increase blue', 'blue shift'],
        field: 'ib_b',
        delta: amount!,
      },
      { match: ['less blue', 'reduce blue'], field: 'ib_b', delta: -amount! },
      {
        match: ['more red', 'redder', 'increase red', 'red shift'],
        field: 'ib_r',
        delta: amount!,
      },
      { match: ['less red', 'reduce red'], field: 'ib_r', delta: -amount! },
      {
        match: ['more green', 'greener', 'increase green'],
        field: 'ib_g',
        delta: amount!,
      },
      { match: ['less green', 'reduce green'], field: 'ib_g', delta: -amount! },
      {
        match: ['warmer', 'more warm', 'increase warmth'],
        field: 'ib_r',
        delta: amount!,
      },
      {
        match: ['cooler', 'more cool', 'increase cool', 'cool shift'],
        field: 'ib_b',
        delta: amount!,
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
        delta: amount!,
      },
      {
        match: ['less warp', 'decrease warp', 'less distortion'],
        field: 'warp',
        delta: -amount!,
      },
      {
        match: ['more zoom', 'zoom in', 'increase zoom'],
        field: 'zoom',
        delta: amount!,
      },
      {
        match: ['less zoom', 'zoom out', 'decrease zoom'],
        field: 'zoom',
        delta: -amount!,
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
        delta: amount!,
      },
      {
        match: ['less saturation', 'less colorful', 'more grey'],
        field: 'saturation',
        delta: -amount!,
      },
      {
        match: ['more contrast', 'increase contrast'],
        field: 'contrast',
        delta: amount!,
      },
      {
        match: ['less contrast', 'decrease contrast'],
        field: 'contrast',
        delta: -amount!,
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
    ];

    let matched = false;
    const results: string[] = [];

    for (const entry of fieldMap) {
      if (entry.match.some((m) => t.includes(m))) {
        matched = true;
        const fieldKey = entry.field;
        const delta = entry.delta;
        try {
          await session.page.evaluate(
            ({ key, delta: d }) => {
              // Find the inspector field by its data-key attribute or label text
              const fieldEl = Array.from(
                document.querySelectorAll('.milkdrop-overlay__field'),
              ).find((el) => {
                const label = el
                  .querySelector('span')
                  ?.textContent?.trim()
                  .toLowerCase();
                return label === key || label?.includes(key);
              });

              if (!fieldEl) return { error: `field ${key} not found` };

              const input = fieldEl.querySelector('input');
              if (!input) return { error: 'no input found' };

              const currentVal = parseFloat(input.value);
              if (isNaN(currentVal)) return { error: 'non-numeric value' };

              const newVal = Math.max(0, Math.min(2, currentVal + d));
              input.value = String(newVal);

              // Dispatch input event for range sliders, change for text inputs
              if (input.type === 'range') {
                input.dispatchEvent(new Event('input', { bubbles: true }));
              } else {
                input.dispatchEvent(new Event('change', { bubbles: true }));
              }

              return { field: key, from: currentVal, to: newVal };
            },
            { key: fieldKey, delta },
          );
          results.push(`  ${fieldKey}: changed`);
        } catch (e) {
          results.push(`  ${fieldKey}: error - ${e}`);
        }
      }
    }

    if (!matched) {
      return asTextResponse(
        `Could not understand "${tweak}". Try: more/less color (red, blue, green), warp, zoom, motion, brightness, saturation, contrast, decay.`,
      );
    }

    await session.page.waitForTimeout(1500);

    return asTextResponse(
      [
        `Applied tweak: "${tweak}"`,
        ...results,
        'Use session_capture_frame to see the result.',
      ].join('\n'),
    );
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
