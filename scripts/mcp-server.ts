import { spawn } from 'node:child_process';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { asTextResponse, createMcpServer } from './mcp-shared.ts';
import { playToy } from './play-toy.ts';

const server = createMcpServer();
const transport = new StdioServerTransport();

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
