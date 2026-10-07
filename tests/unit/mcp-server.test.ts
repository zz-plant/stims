import { afterEach, describe, expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { MILKDROP_BUILTIN_DOCS } from 'milkdrop-toolchain/src/builtin-docs.ts';
import packageJson from '../../package.json';
import {
  buildDocPointers,
  defaultQualityGateTimeoutMs,
  getDocSectionContent,
  getReadmeDevCommands,
  markdownSources,
  resolveQualityGateCommand,
  runCommand,
  searchMarkdownSources,
} from '../../scripts/mcp-server.ts';
import mcpWorker from '../../scripts/mcp-worker.ts';

/** Sends one JSON-RPC request through the Worker's HTTP handler. */
async function callWorker(
  method: string,
  params: Record<string, unknown> = {},
) {
  const response = await mcpWorker.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  const body = await response.text();
  const event = body.split('\n').find((line) => line.startsWith('data: '));
  return JSON.parse(event ? event.slice('data: '.length) : body);
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const { result } = await callWorker('tools/call', {
    name,
    arguments: args,
  });
  return result.content[0].text as string;
}

describe('MCP tool surface', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function serveCatalog(presets: unknown[]) {
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ presets })),
    ) as unknown as typeof fetch;
  }

  test('lists the preset tools and none of the retired toy tools', async () => {
    const { result } = await callWorker('tools/list');
    const names = result.tools.map((tool: { name: string }) => tool.name);

    expect(names).toContain('get_audio_reactivity_guide');
    expect(names).toContain('open_preset_url');
    for (const retired of [
      'get_toys',
      'launch_toy',
      'get_toy_audio_reactivity_guide',
      'describe_loader',
    ]) {
      expect(names).not.toContain(retired);
    }
  });

  test('the audio guide names only signals the compiler knows', async () => {
    const guide = await callTool('get_audio_reactivity_guide');
    const signals = new Set(
      MILKDROP_BUILTIN_DOCS.filter((entry) => entry.group === 'signal').map(
        (entry) => entry.name,
      ),
    );

    for (const name of [
      'bass',
      'mid',
      'treb',
      'bass_att',
      'mid_att',
      'treb_att',
      'vol',
      'rms',
      'beat_pulse',
    ]) {
      expect(guide).toContain(`\`${name}\``);
      expect(signals.has(name)).toBe(true);
    }
  });

  test('the audio guide sends readers to docs and commands that exist', async () => {
    const guide = await callTool('get_audio_reactivity_guide');
    const reference = await getDocSectionContent(
      'docs/authoring/reference.md',
      'Signals (read-only inputs)',
    );
    const listening = await getDocSectionContent(
      'docs/authoring/03-listening.md',
    );

    expect(guide).toContain('"Signals (read-only inputs)"');
    expect(reference.ok).toBe(true);
    expect(listening.ok).toBe(true);
    for (const script of ['lab:dataflow', 'lab:reactivity'] as const) {
      expect(guide).toContain(`bun run ${script} -- --preset <id>`);
      expect(packageJson.scripts[script]).toBeDefined();
    }
  });

  test('serves the boot path from docs/ARCHITECTURE.md in place of describe_loader', async () => {
    const section = await callTool('read_doc_section', {
      file: 'docs/ARCHITECTURE.md',
      heading: 'App bootstrap',
    });

    expect(section).toContain('src/js/app.ts');
  });

  test("reports a preset's audio scores from the catalog", async () => {
    serveCatalog([
      {
        id: 'waves-only',
        title: 'Waves Only',
        author: 'Tester',
        quality: { components: { staticAudio: 0.5, measuredReactivity: null } },
      },
      {
        id: 'driven',
        title: 'Driven',
        author: 'Tester',
        quality: { components: { staticAudio: 1, measuredReactivity: 0.8201 } },
      },
    ]);

    const wavesOnly = await callTool('get_audio_reactivity_guide', {
      presetId: 'waves-only',
    });
    expect(wavesOnly).toContain('## Waves Only (`waves-only`)');
    expect(wavesOnly).toContain('waveform only');
    expect(wavesOnly).toContain(
      'Measured reactivity (lab:reactivity): not measured',
    );
    expect(wavesOnly).toContain('bun run lab:dataflow -- --preset waves-only');

    const driven = await callTool('get_audio_reactivity_guide', {
      presetId: 'driven',
    });
    expect(driven).toContain('driven: audio changes what it draws');
    expect(driven).toContain('Measured reactivity (lab:reactivity): 0.82,');
  });

  test('an unknown preset id is reported, not answered with a generic guide', async () => {
    serveCatalog([]);

    const text = await callTool('get_audio_reactivity_guide', {
      presetId: 'missing',
    });

    expect(text).toBe(
      'Preset "missing" not found. Use search_presets to find a preset ID.',
    );
  });

  test('still answers with the guide when the catalog is unreachable', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    const text = await callTool('get_audio_reactivity_guide', {
      presetId: 'driven',
    });

    expect(text).toContain('# How MilkDrop presets react to audio');
    expect(text).toContain('could not be loaded');
    expect(text).toContain('bun run lab:reactivity -- --preset driven');
  });
});

describe('getDocSectionContent', () => {
  test('returns a specific heading section when present', async () => {
    const result = await getDocSectionContent(
      'docs/MCP_SERVER.md',
      'Tool Categories',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('Tool Categories');
      expect(result.content).toContain('list_docs');
    }
  });

  test('returns a friendly error when a heading is missing', async () => {
    const result = await getDocSectionContent(
      'docs/MCP_SERVER.md',
      'This heading does not exist',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('was not found');
    }
  });
});

describe('searchMarkdownSources', () => {
  test('finds matches across markdown files', async () => {
    const results = await searchMarkdownSources('Tool Categories', {
      file: 'docs/MCP_SERVER.md',
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.file).toBe('docs/MCP_SERVER.md');
    expect(results[0]?.heading).toContain('Tool Categories');
  });

  test('returns empty results when no matches exist', async () => {
    const results = await searchMarkdownSources('this should not match');

    expect(results).toHaveLength(0);
  });
});

describe('README-derived MCP guidance', () => {
  test('builds doc pointers from the current README headings', async () => {
    const pointers = await buildDocPointers();

    expect(pointers).toContain('Quickstart');
    expect(pointers).toContain('Common commands');
    expect(pointers).toContain('Repository layout');
  });

  test('surfaces the current session-oriented dev workflow', async () => {
    const commands = await getReadmeDevCommands('dev');

    expect(commands).toContain('bun run dev');
    expect(commands).toContain('bun run check');
  });

  test('returns an explicit lint fallback when README omits lint-only commands', async () => {
    const commands = await getReadmeDevCommands('lint');

    expect(commands).toContain('does not currently list lint-only commands');
  });
});

describe('agent capability markdown availability', () => {
  test('exposes skill and workflow markdown files for MCP reads', () => {
    expect(
      markdownSources['docs/agents/agent-handoffs.md'].length,
    ).toBeGreaterThan(0);
    expect(
      markdownSources['.agent/skills/play-visualizer/SKILL.md'].length,
    ).toBeGreaterThan(0);
    expect(
      markdownSources['.agent/workflows/play-visualizer.md'].length,
    ).toBeGreaterThan(0);
    expect(
      markdownSources['.agent/skills/modify-visualizer-runtime/SKILL.md']
        .length,
    ).toBeGreaterThan(0);
    expect(
      markdownSources['.agent/workflows/modify-visualizer-runtime.md'].length,
    ).toBeGreaterThan(0);
  });

  test('searches agent docs content through shared markdown index', async () => {
    const results = await searchMarkdownSources('progressive-disclosure', {
      file: 'docs/agents/README.md',
      limit: 3,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.file).toBe('docs/agents/README.md');
  });
});

describe('resolveQualityGateCommand', () => {
  test('defaults to the full quality gate command', () => {
    const command = resolveQualityGateCommand();

    expect(command.scope).toBe('full');
    expect(command.command).toBe('bun');
    expect(command.args).toEqual(['run', 'check']);
    expect(command.printableCommand).toBe('bun run check');
  });

  test('resolves quick scope command', () => {
    const command = resolveQualityGateCommand('quick');

    expect(command.scope).toBe('quick');
    expect(command.args).toEqual(['run', 'check:quick']);
    expect(command.printableCommand).toBe('bun run check:quick');
  });
});

describe('runCommand', () => {
  test('returns stderr when command is missing', async () => {
    const result = await runCommand('this-command-does-not-exist-stim', []);

    expect(result.exitCode).toBeNull();
    expect(result.timedOut).toBe(false);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  test('times out long-running commands', async () => {
    const result = await runCommand(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      100,
      50,
    );

    expect(result.exitCode).toBeNull();
    expect(result.timedOut).toBe(true);
    expect(result.stderr).toContain('timed out');
  });

  test('escalates to SIGKILL when SIGTERM does not close the child', async () => {
    const signals: string[] = [];

    class FakeChildProcess extends EventEmitter {
      stdout = new PassThrough();
      stderr = new PassThrough();

      kill(signal: string) {
        signals.push(signal);
        if (signal === 'SIGKILL') {
          this.emit('close', null);
        }
        return true;
      }
    }

    const fakeSpawn = () => new FakeChildProcess();

    const result = await runCommand(
      'bun',
      ['run', 'check'],
      50,
      25,
      fakeSpawn as unknown as typeof import('node:child_process').spawn,
    );

    expect(result.timedOut).toBe(true);
    expect(result.stderr).toContain('Escalated to SIGKILL');
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  test('exposes the default timeout constant', () => {
    expect(defaultQualityGateTimeoutMs).toBe(600000);
  });
});
