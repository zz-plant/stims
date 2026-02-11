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
) {
  return await new Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }>((resolve) => {
    const child = spawn(command, [...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let settled = false;

    const finalize = (result: {
      exitCode: number | null;
      stdout?: string;
      stderr?: string;
      timedOut: boolean;
    }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode: result.exitCode,
        stdout: result.stdout ?? stdoutChunks.join('').trim(),
        stderr: result.stderr ?? stderrChunks.join('').trim(),
        timedOut: result.timedOut,
      });
    };

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      finalize({
        exitCode: null,
        stderr:
          stderrChunks.join('').trim() ||
          `Command timed out after ${timeoutMs}ms.`,
        timedOut: true,
      });
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
        timedOut: false,
      });
    });

    child.on('close', (exitCode) => {
      finalize({
        exitCode,
        timedOut: false,
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

export { startServer };
export * from './mcp-shared.ts';
export { defaultQualityGateTimeoutMs, resolveQualityGateCommand, runCommand };
