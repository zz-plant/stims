import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { jsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/types.js';
import { z } from 'zod';
import agentAgentErgonomicsSkill from '../.agent/skills/agent-ergonomics/SKILL.md';
import agentAuditRecurringFixesSkill from '../.agent/skills/audit-recurring-fixes/SKILL.md';
import agentIterateVisualizerUiSkill from '../.agent/skills/iterate-visualizer-ui/SKILL.md';
import agentModifyPresetWorkflowSkill from '../.agent/skills/modify-preset-workflow/SKILL.md';
import agentModifyVisualizerRuntimeSkill from '../.agent/skills/modify-visualizer-runtime/SKILL.md';
import agentPlayVisualizerSkill from '../.agent/skills/play-visualizer/SKILL.md';
import agentQuickStartSkill from '../.agent/skills/quick-start/SKILL.md';
import agentReviewRendererFallbackSkill from '../.agent/skills/review-renderer-fallback/SKILL.md';
import agentReviewTestHarnessSkill from '../.agent/skills/review-test-harness/SKILL.md';
import agentReviewWebgpuParitySkill from '../.agent/skills/review-webgpu-parity/SKILL.md';
import agentReviewWorkspaceUiStateSkill from '../.agent/skills/review-workspace-ui-state/SKILL.md';
import agentShipVisualizerChangeSkill from '../.agent/skills/ship-visualizer-change/SKILL.md';
import agentTestVisualizerSkill from '../.agent/skills/test-visualizer/SKILL.md';
import agentModifyPresetWorkflowWorkflow from '../.agent/workflows/modify-preset-workflow.md';
import agentModifyVisualizerRuntimeWorkflow from '../.agent/workflows/modify-visualizer-runtime.md';
import agentPlayVisualizerWorkflow from '../.agent/workflows/play-visualizer.md';
import agentShipVisualizerChangeWorkflow from '../.agent/workflows/ship-visualizer-change.md';
import agentTestVisualizerWorkflow from '../.agent/workflows/test-visualizer.md';
import docsClaudeReadme from '../.claude/CLAUDE.md';
import toyManifest from '../assets/js/data/toy-manifest.ts';
import docsAgentsAgentHandoffs from '../docs/agents/agent-handoffs.md';
import docsAgentsReadme from '../docs/agents/README.md';
import docsDevelopment from '../docs/DEVELOPMENT.md';
import docsMcpServer from '../docs/MCP_SERVER.md';
import docsReadme from '../docs/README.md';
import docsToyDevelopment from '../docs/TOY_DEVELOPMENT.md';
import docsToyScriptIndex from '../docs/TOY_SCRIPT_INDEX.md';
import docsToys from '../docs/toys.md';
import readme from '../README.md';

const defaultInstructions =
  'Use these tools to surface documentation, toy metadata, loader behavior, and development commands for the Stim Webtoys library.';

const markdownSources = {
  'README.md': readme,
  'docs/README.md': docsReadme,
  'docs/MCP_SERVER.md': docsMcpServer,
  'docs/DEVELOPMENT.md': docsDevelopment,
  'docs/TOY_DEVELOPMENT.md': docsToyDevelopment,
  'docs/TOY_SCRIPT_INDEX.md': docsToyScriptIndex,
  'docs/toys.md': docsToys,
  'docs/agents/README.md': docsAgentsReadme,
  'docs/agents/agent-handoffs.md': docsAgentsAgentHandoffs,
  '.claude/CLAUDE.md': docsClaudeReadme,
  '.agent/skills/modify-preset-workflow/SKILL.md':
    agentModifyPresetWorkflowSkill,
  '.agent/skills/modify-visualizer-runtime/SKILL.md':
    agentModifyVisualizerRuntimeSkill,
  '.agent/skills/play-visualizer/SKILL.md': agentPlayVisualizerSkill,
  '.agent/skills/ship-visualizer-change/SKILL.md':
    agentShipVisualizerChangeSkill,
  '.agent/skills/test-visualizer/SKILL.md': agentTestVisualizerSkill,
  '.agent/skills/quick-start/SKILL.md': agentQuickStartSkill,
  '.agent/skills/agent-ergonomics/SKILL.md': agentAgentErgonomicsSkill,
  '.agent/workflows/modify-preset-workflow.md':
    agentModifyPresetWorkflowWorkflow,
  '.agent/workflows/modify-visualizer-runtime.md':
    agentModifyVisualizerRuntimeWorkflow,
  '.agent/workflows/play-visualizer.md': agentPlayVisualizerWorkflow,
  '.agent/workflows/ship-visualizer-change.md':
    agentShipVisualizerChangeWorkflow,
  '.agent/workflows/test-visualizer.md': agentTestVisualizerWorkflow,
  '.agent/skills/review-webgpu-parity/SKILL.md': agentReviewWebgpuParitySkill,
  '.agent/skills/review-renderer-fallback/SKILL.md':
    agentReviewRendererFallbackSkill,
  '.agent/skills/review-test-harness/SKILL.md': agentReviewTestHarnessSkill,
  '.agent/skills/review-workspace-ui-state/SKILL.md':
    agentReviewWorkspaceUiStateSkill,
  '.agent/skills/audit-recurring-fixes/SKILL.md': agentAuditRecurringFixesSkill,
  '.agent/skills/iterate-visualizer-ui/SKILL.md': agentIterateVisualizerUiSkill,
} as const;

type MarkdownSourceKey = keyof typeof markdownSources;

type DocSectionResult =
  | { ok: true; content: string }
  | { ok: false; message: string };

type DocSearchResult = {
  file: MarkdownSourceKey;
  heading: string;
  startLine: number;
  endLine: number;
  excerpt: string;
};

type CreateServerOptions = {
  instructions?: string;
  jsonSchemaValidator?: jsonSchemaValidator;
};

type ToyMetadata = {
  slug: string;
  title: string;
  description: string;
  requiresWebGPU: boolean;
  controls: string[];
  module: string | null;
  type: string | null;
  allowWebGLFallback: boolean;
  url: string;
};

type AgentCapability = {
  name: string;
  kind: 'skill' | 'workflow';
  path: MarkdownSourceKey;
  description: string;
  command: string;
};

const agentCapabilities: AgentCapability[] = [
  {
    name: 'modify-preset-workflow',
    kind: 'skill',
    path: '.agent/skills/modify-preset-workflow/SKILL.md',
    description:
      'Modify bundled presets, editor/catalog behavior, and compatibility workflows.',
    command: '/modify-preset-workflow',
  },
  {
    name: 'modify-visualizer-runtime',
    kind: 'skill',
    path: '.agent/skills/modify-visualizer-runtime/SKILL.md',
    description:
      'Modify shared runtime, loader, shell, renderer, audio, or capability behavior.',
    command: '/modify-visualizer-runtime',
  },
  {
    name: 'play-visualizer',
    kind: 'skill',
    path: '.agent/skills/play-visualizer/SKILL.md',
    description:
      'Launch the flagship visualizer locally and perform manual interaction checks.',
    command: '/play-visualizer',
  },
  {
    name: 'ship-visualizer-change',
    kind: 'skill',
    path: '.agent/skills/ship-visualizer-change/SKILL.md',
    description:
      'Run end-to-end visualizer change workflow including checks and docs sync.',
    command: '/ship-visualizer-change',
  },
  {
    name: 'test-visualizer',
    kind: 'skill',
    path: '.agent/skills/test-visualizer/SKILL.md',
    description:
      'Execute visualizer-focused test passes and report failures quickly.',
    command: '/test-visualizer',
  },
  {
    name: 'quick-start',
    kind: 'skill',
    path: '.agent/skills/quick-start/SKILL.md',
    description: 'Fastest safe path into the repo when dropped in cold.',
    command: '/quick-start',
  },
  {
    name: 'agent-ergonomics',
    kind: 'skill',
    path: '.agent/skills/agent-ergonomics/SKILL.md',
    description:
      'Understanding how skills, workflows, sessions, and gates fit together; improving agent infrastructure.',
    command: '/agent-ergonomics',
  },
  {
    name: 'modify-preset-workflow',
    kind: 'workflow',
    path: '.agent/workflows/modify-preset-workflow.md',
    description:
      'Workflow checklist for bundled preset, editor, import/export, and compatibility changes.',
    command: '/modify-preset-workflow',
  },
  {
    name: 'modify-visualizer-runtime',
    kind: 'workflow',
    path: '.agent/workflows/modify-visualizer-runtime.md',
    description:
      'Workflow checklist for implementing and validating shared visualizer runtime changes.',
    command: '/modify-visualizer-runtime',
  },
  {
    name: 'play-visualizer',
    kind: 'workflow',
    path: '.agent/workflows/play-visualizer.md',
    description:
      'Workflow checklist for launching and manually validating the flagship visualizer.',
    command: '/play-visualizer',
  },
  {
    name: 'ship-visualizer-change',
    kind: 'workflow',
    path: '.agent/workflows/ship-visualizer-change.md',
    description:
      'Workflow checklist for implementation, quality gate, and docs sync.',
    command: '/ship-visualizer-change',
  },
  {
    name: 'test-visualizer',
    kind: 'workflow',
    path: '.agent/workflows/test-visualizer.md',
    description: 'Workflow checklist for visualizer-specific automated checks.',
    command: '/test-visualizer',
  },
  {
    name: 'review-webgpu-parity',
    kind: 'skill',
    path: '.agent/skills/review-webgpu-parity/SKILL.md',
    description:
      'Review PRs touching WebGPU/WebGL dual-backend parity (feedback, shaders, renderer adapters).',
    command: '/review-webgpu-parity',
  },
  {
    name: 'review-renderer-fallback',
    kind: 'skill',
    path: '.agent/skills/review-renderer-fallback/SKILL.md',
    description:
      'Review PRs touching renderer capability probing, fallback chains, timeout logic, or audio worklet init.',
    command: '/review-renderer-fallback',
  },
  {
    name: 'review-test-harness',
    kind: 'skill',
    path: '.agent/skills/review-test-harness/SKILL.md',
    description:
      'Review PRs adding or modifying tests, fixtures, or integration harness code.',
    command: '/review-test-harness',
  },
  {
    name: 'review-workspace-ui-state',
    kind: 'skill',
    path: '.agent/skills/review-workspace-ui-state/SKILL.md',
    description:
      'Review PRs touching React workspace UI state, URL routing, toast/panel behavior, or engine adapter boundary.',
    command: '/review-workspace-ui-state',
  },
  {
    name: 'audit-recurring-fixes',
    kind: 'skill',
    path: '.agent/skills/audit-recurring-fixes/SKILL.md',
    description:
      'Audit commit history to find recurring fix patterns and update prevention skills.',
    command: '/audit-recurring-fixes',
  },
  {
    name: 'iterate-visualizer-ui',
    kind: 'skill',
    path: '.agent/skills/iterate-visualizer-ui/SKILL.md',
    description:
      'Iterate on workspace UI, shell chrome, and CSS with fast feedback loops and component isolation.',
    command: '/iterate-visualizer-ui',
  },
];

const serverInfo = { name: 'stim-webtoys-mcp', version: '1.0.0' } as const;

function createMcpServer({
  instructions = defaultInstructions,
  jsonSchemaValidator,
}: CreateServerOptions = {}) {
  const server = new McpServer(serverInfo, {
    capabilities: { tools: {} },
    instructions,
    jsonSchemaValidator,
  });

  registerTools(server);

  return server;
}

function registerTools(server: McpServer) {
  server.registerTool(
    'list_docs',
    {
      description:
        'Return quick-start, runtime, repository layout, and manifest-doc pointers from README.md with line references.',
      inputSchema: z.object({}).strict(),
    },
    async () => {
      const pointers = await buildDocPointers();

      return asTextResponse(pointers || 'README content was not available.');
    },
  );

  server.registerTool(
    'get_toys',
    {
      description:
        'Return structured toy metadata (including controls and module info) from assets/data/toys.json with optional slug or WebGPU filters.',
      inputSchema: z
        .object({
          slug: z
            .string()
            .trim()
            .optional()
            .describe('Limit results to a specific toy slug.'),
          requiresWebGPU: z
            .boolean()
            .optional()
            .describe(
              'Filter by WebGPU requirement (true = only WebGPU toys).',
            ),
        })
        .strict(),
    },
    async ({ slug, requiresWebGPU }) => {
      const toys = normalizeToys(toyManifest);

      const filtered = toys.filter((toy) => {
        if (slug && toy.slug !== slug) return false;
        if (
          typeof requiresWebGPU === 'boolean' &&
          toy.requiresWebGPU !== requiresWebGPU
        )
          return false;
        return true;
      });

      if (!filtered.length) {
        return asTextResponse('No toys matched the requested filters.');
      }

      return asTextResponse(JSON.stringify(filtered, null, 2));
    },
  );

  server.registerTool(
    'read_doc_section',
    {
      description:
        'Return an entire markdown file or a specific heading section from README.md or docs/*.md.',
      inputSchema: z
        .object({
          file: z
            .enum(
              Object.keys(markdownSources) as [
                MarkdownSourceKey,
                ...MarkdownSourceKey[],
              ],
            )
            .describe(
              'Markdown file to read (e.g., README.md or docs/MCP_SERVER.md).',
            ),
          heading: z
            .string()
            .trim()
            .optional()
            .describe(
              'Optional heading text to narrow the response to a single section.',
            ),
        })
        .strict(),
    },
    async ({ file, heading }) => {
      const result = await getDocSectionContent(file, heading);

      return asTextResponse(result.ok ? result.content : result.message);
    },
  );

  server.registerTool(
    'search_docs',
    {
      description:
        'Search for a keyword across README.md and docs/*.md, returning matching sections with line ranges.',
      inputSchema: z
        .object({
          query: z.string().trim().min(1).describe('Search keyword or phrase.'),
          file: z
            .enum(
              Object.keys(markdownSources) as [
                MarkdownSourceKey,
                ...MarkdownSourceKey[],
              ],
            )
            .optional()
            .describe('Optional markdown file to limit the search.'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(20)
            .optional()
            .describe('Maximum number of matches to return (default: 10).'),
        })
        .strict(),
    },
    async ({ query, file, limit }) => {
      const matches = await searchMarkdownSources(query, {
        file,
        limit,
      });

      if (!matches.length) {
        return asTextResponse(`No matches found for "${query}".`);
      }

      const response = matches
        .map((match) =>
          [
            `File: ${match.file}`,
            `Heading: ${match.heading}`,
            `Lines: L${match.startLine}-L${match.endLine}`,
            'Excerpt:',
            match.excerpt,
          ].join('\n'),
        )
        .join('\n\n');

      return asTextResponse(response);
    },
  );

  server.registerTool(
    'describe_loader',
    {
      description:
        'Summarize how toy loading and error handling works based on assets/js/loader.ts.',
      inputSchema: z.object({}).strict(),
    },
    async () => {
      const loaderDetails = [
        '- Loader derives the manifest path from the current URL to resolve compiled module files (`/.vite/manifest.json`).',
        '- Query param `toy` controls navigation; history updates keep the slug in the URL and restore the library view when removed.',
        '- `loadToy` clears any active toy, shows the active container, and gates WebGPU-only entries before importing modules.',
        '- Imports are resolved through Vite manifest entries when available, with fallbacks for relative and absolute module paths.',
        '- Visible status blocks appear while loading; errors render actionable messages for missing dev server, MIME mismatches, or file:// access.',
        '- A reusable "Back to Library" control and history updates let users return to the catalog without reloads.',
      ];

      return asTextResponse(loaderDetails.join('\n'));
    },
  );

  server.registerTool(
    'list_agent_capabilities',
    {
      description:
        'List reusable agent skills/workflows that can be invoked to support human users, including path and command references.',
      inputSchema: z
        .object({
          kind: z
            .enum(['skill', 'workflow'])
            .optional()
            .describe('Optionally filter to only skills or only workflows.'),
        })
        .strict(),
    },
    async ({ kind }) => {
      const capabilities = agentCapabilities.filter((capability) =>
        kind ? capability.kind === kind : true,
      );

      if (!capabilities.length) {
        return asTextResponse(
          'No agent capabilities matched the requested filter.',
        );
      }

      return asTextResponse(JSON.stringify(capabilities, null, 2));
    },
  );

  server.registerTool(
    'read_agent_capability',
    {
      description:
        'Read a specific agent skill/workflow markdown file so MCP clients can execute the same playbook steps.',
      inputSchema: z
        .object({
          kind: z
            .enum(['skill', 'workflow'])
            .describe('Capability type to read.'),
          name: z
            .string()
            .trim()
            .min(1)
            .describe(
              'Capability name such as modify-visualizer-runtime, play-visualizer, or test-visualizer.',
            ),
        })
        .strict(),
    },
    async ({ kind, name }) => {
      const capability = agentCapabilities.find(
        (entry) => entry.kind === kind && entry.name === name,
      );

      if (!capability) {
        return asTextResponse(
          `No ${kind} named "${name}" was found. Use list_agent_capabilities first.`,
        );
      }

      const result = await getDocSectionContent(capability.path);
      if (!result.ok) {
        return asTextResponse(result.message);
      }

      const response = [
        `# ${capability.kind}: ${capability.name}`,
        '',
        `Path: ${capability.path}`,
        `Command: ${capability.command}`,
        '',
        result.content,
      ].join('\n');

      return asTextResponse(response);
    },
  );

  server.registerTool(
    'dev_commands',
    {
      description:
        'Return installation and development commands from README.md.',
      inputSchema: z
        .object({
          scope: z
            .enum(['setup', 'dev', 'build', 'test', 'lint'])
            .optional()
            .describe('Limit output to a specific workflow area.'),
        })
        .strict(),
    },
    async ({ scope }) => {
      const text = await getReadmeDevCommands(scope);

      return asTextResponse(
        text || 'No development guidance was found in README.md.',
      );
    },
  );

  server.registerTool(
    'launch_toy',
    {
      description:
        'Launch a toy in headless mode and enable demo audio for visualization. Returns instructions for capturing screenshots or observing audio reactivity.',
      inputSchema: z
        .object({
          slug: z
            .string()
            .trim()
            .describe('The toy slug to launch (for example, "milkdrop").'),
          port: z
            .number()
            .int()
            .min(1024)
            .max(65535)
            .optional()
            .default(5173)
            .describe('Dev server port (defaults to 5173).'),
        })
        .strict(),
    },
    async ({ slug, port = 5173 }) => {
      const toy = normalizeToys(toyManifest).find((t) => t.slug === slug);

      if (!toy) {
        return asTextResponse(
          `Toy "${slug}" not found. Use get_toys to list available toys.`,
        );
      }

      const url = `http://localhost:${port}/milkdrop/?experience=${encodeURIComponent(slug)}`;

      const instructions = [
        `# Launching ${toy.title}`,
        '',
        `**URL:** ${url}`,
        `**Description:** ${toy.description}`,
        '',
        '## Steps to interact:',
        '1. Ensure dev server is running: `bun run dev`',
        '2. Open the URL in a browser or headless browser',
        '3. Look for the audio prompt modal',
        '4. Click "Use demo audio" to enable procedural audio',
        '5. Wait 3-5 seconds for the visualization to react',
        '',
        '## What to observe:',
        toy.requiresWebGPU
          ? '- This toy requires WebGPU support'
          : '- This toy runs with WebGL',
        '- Visual effects that pulse with bass frequencies',
        '- Color changes responding to mid-range frequencies',
        '- Sparkles or fine details reacting to high frequencies',
        '',
        '## Controls:',
        ...(toy.controls.length > 0
          ? toy.controls.map((c) => `- ${c}`)
          : ['- No custom controls documented']),
        '',
        '**Press Escape to return to the library.**',
      ].join('\n');

      return asTextResponse(instructions);
    },
  );

  server.registerTool(
    'get_toy_audio_reactivity_guide',
    {
      description:
        'Get a guide on how toys respond to audio frequencies and what visual effects to look for when a toy is playing with demo audio.',
      inputSchema: z
        .object({
          slug: z
            .string()
            .trim()
            .optional()
            .describe('Specific toy slug for targeted guidance.'),
        })
        .strict(),
    },
    async ({ slug }) => {
      const guide = [
        '# Audio Reactivity Guide',
        '',
        '## How Toys React to Audio',
        '',
        'Stim toys use the AudioHandler to analyze frequency bands and translate them into visual effects:',
        '',
        '### Frequency Band Mapping',
        '- **Bass (20-250 Hz)**: Large-scale movements, pulses, expansions',
        '  - Examples: Halo size, spiral burst radius, camera shake',
        '  - Visual cues: Scaling, position offsets, bloom intensity',
        '',
        '- **Mids (250-4000 Hz)**: Color shifts, rotations, secondary motion',
        '  - Examples: Hue cycling, particle velocity, shape morphing',
        '  - Visual cues: Color temperature, rotation speed, warp effects',
        '',
        '- **Highs (4000-20000 Hz)**: Fine details, sparkles, edge effects',
        '  - Examples: Particle emission, shimmer, grain noise',
        '  - Visual cues: Brightness spikes, detail layers, pixel shimmer',
        '',
        '### Common Audio-Reactive Patterns',
        '1. **Beat detection**: Sudden visual changes on strong transients',
        '2. **Smoothed envelopes**: Gradual visual changes following energy curves',
        '3. **Multi-band visualization**: Different visual elements per frequency band',
        '',
        '## Demo Audio',
        'Demo audio is procedural and contains:',
        '- Consistent bass beats for rhythm',
        '- Melodic mid-range content',
        '- High-frequency harmonics and noise bursts',
        '',
        '## What to Look For',
        'When observing a toy with demo audio:',
        '- Note the timing between audio events and visual changes',
        '- Watch for different elements reacting to different frequencies',
        '- Check if effects are smooth (filtered) or immediate (unfiltered)',
        '- Observe if there are distinct "layers" of reactivity',
      ];

      if (slug) {
        const toy = normalizeToys(toyManifest).find((t) => t.slug === slug);
        if (toy) {
          guide.push('', `## Specific to "${toy.title}"`, '');
          guide.push(`**Description:** ${toy.description}`);

          // Add slug-specific hints for the shipped MilkDrop experience.
          const slugHints: Record<string, string[]> = {
            milkdrop: [
              '- Blend transitions and warp density should swell with bass energy',
              '- Palette shifts, motion, and preset layering should stay responsive through mids',
              '- Fine shimmer, mesh detail, and edge activity should lift with highs',
            ],
          };

          if (slugHints[slug]) {
            guide.push('', '### Expected Behaviors:', ...slugHints[slug]);
          }
        }
      }

      return asTextResponse(guide.join('\n'));
    },
  );
}

async function loadReadme() {
  return await loadMarkdownFile('README.md');
}

async function loadReadmeLines() {
  const readmeContent = await loadReadme();
  return readmeContent.split(/\r?\n/);
}

type SectionExcerpt = {
  startLine: number;
  endLine: number;
  content: string[];
};

async function buildDocPointers() {
  const lines = await loadReadmeLines();

  const quickStart = extractSectionWithRange(lines, 'Quickstart');
  const commands = extractSectionWithRange(lines, 'Common commands');
  const layout = extractSectionWithRange(lines, 'Project shape');
  const docs = extractSectionWithRange(lines, 'Docs');

  const entries = [
    quickStart && formatPointer('Quickstart', quickStart),
    commands && formatPointer('Common commands', commands),
    layout && formatPointer('Repository layout', layout),
    docs && formatPointer('Docs entry points', docs),
  ].filter(Boolean) as string[];

  return entries.join('\n\n');
}

function formatPointer(title: string, excerpt: SectionExcerpt) {
  const range = `README.md:L${excerpt.startLine}-L${excerpt.endLine}`;
  return `${title} (${range})\n${excerpt.content.join('\n')}`;
}

function extractSectionWithRange(
  lines: string[],
  heading: string,
): SectionExcerpt | null {
  const headingIndex = lines.findIndex(
    (line) => line.trim() === `## ${heading}`,
  );

  if (headingIndex === -1) return null;

  const nextHeadingOffset = lines
    .slice(headingIndex + 1)
    .findIndex((line) => line.trim().startsWith('## '));
  const nextHeadingIndex =
    nextHeadingOffset === -1
      ? lines.length
      : headingIndex + 1 + nextHeadingOffset;
  const endIndex = Math.max(headingIndex, nextHeadingIndex - 1);

  return {
    startLine: headingIndex + 1,
    endLine: endIndex + 1,
    content: lines.slice(headingIndex, nextHeadingIndex),
  };
}

function extractRuntimeRange(lines: string[]): SectionExcerpt | null {
  const startIndex = lines.findIndex((line) =>
    line.includes('Choose your runtime'),
  );

  if (startIndex === -1) return null;

  let endIndex = startIndex;

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();

    if (/^\d+\.\s/.test(trimmed) || trimmed.startsWith('## ')) {
      break;
    }

    endIndex = i;
  }

  return {
    startLine: startIndex + 1,
    endLine: endIndex + 1,
    content: lines.slice(startIndex, endIndex + 1),
  };
}

function extractSection(markdown: string, heading: string) {
  return extractMarkdownSection(markdown, heading)?.content ?? null;
}

async function getReadmeDevCommands(
  scope?: 'setup' | 'dev' | 'build' | 'test' | 'lint',
) {
  const readmeContent = await loadReadme();
  const quickstart = extractSection(readmeContent, 'Quickstart');
  const commonCommands = extractSection(readmeContent, 'Common commands');
  const developmentNotes = extractSection(readmeContent, 'Development notes');

  const sections: Record<string, string> = {
    setup: quickstart ?? 'README.md does not currently expose setup guidance.',
    dev: [commonCommands, developmentNotes].filter(Boolean).join('\n\n'),
    build: [commonCommands, developmentNotes].filter(Boolean).join('\n\n'),
    test: [commonCommands, developmentNotes].filter(Boolean).join('\n\n'),
    lint: 'README.md does not currently list lint-only commands. Use `bun run check` or see docs/agents/tooling-and-quality.md.',
  };

  const combined = [quickstart, commonCommands, developmentNotes]
    .filter(Boolean)
    .join('\n\n');

  return scope ? sections[scope] : combined;
}

function escapeForRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function asTextResponse(text: string) {
  return {
    content: [
      {
        type: 'text' as const,
        text,
      },
    ],
  };
}

function normalizeToys(data: unknown): ToyMetadata[] {
  if (!Array.isArray(data)) return [];

  return data
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const entry = item as Record<string, unknown>;

      const slug = typeof entry.slug === 'string' ? entry.slug : null;
      const title = typeof entry.title === 'string' ? entry.title : '';
      const description =
        typeof entry.description === 'string' ? entry.description : '';
      const requiresWebGPU =
        typeof entry.requiresWebGPU === 'boolean'
          ? entry.requiresWebGPU
          : false;
      const module = typeof entry.module === 'string' ? entry.module : null;
      const type = typeof entry.type === 'string' ? entry.type : null;
      const allowWebGLFallback =
        typeof entry.allowWebGLFallback === 'boolean'
          ? entry.allowWebGLFallback
          : false;
      const controls = Array.isArray(entry.controls)
        ? entry.controls.filter(
            (control): control is string => typeof control === 'string',
          )
        : [];

      if (!slug) return null;

      return {
        slug,
        title: title || slug,
        description,
        requiresWebGPU,
        controls,
        module,
        type,
        allowWebGLFallback,
        url: `milkdrop/?experience=${encodeURIComponent(slug)}`,
      };
    })
    .filter((entry): entry is ToyMetadata => Boolean(entry));
}

function extractMarkdownSection(markdown: string, heading: string) {
  const pattern = new RegExp(
    `^(#{1,6}\\s+${escapeForRegex(heading)})\\s*$`,
    'm',
  );
  const match = pattern.exec(markdown);

  if (!match) return null;

  const startIndex = match.index + match[0].length;
  const rest = markdown.slice(startIndex);
  const nextHeading = rest.search(/^#{1,6}\\s+/m);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  return {
    heading: match[1].trim(),
    content: section.trim(),
  };
}

function getMarkdownSections(lines: string[], fallbackHeading: string) {
  const headingLines = lines
    .map((line, index) => ({
      line,
      index,
    }))
    .filter(({ line }) => /^#{1,6}\s+/.test(line.trim()));

  if (headingLines.length === 0) {
    return [
      {
        heading: fallbackHeading,
        startLine: 1,
        endLine: lines.length,
        content: lines,
      },
    ];
  }

  return headingLines.map((headingEntry, idx) => {
    const next = headingLines[idx + 1];
    const start = headingEntry.index;
    const end = next ? next.index - 1 : lines.length - 1;
    const heading = headingEntry.line.replace(/^#{1,6}\s+/, '').trim();

    return {
      heading: heading || fallbackHeading,
      startLine: start + 1,
      endLine: end + 1,
      content: lines.slice(start, end + 1),
    };
  });
}

async function loadMarkdownFile(file: MarkdownSourceKey) {
  const resolved = markdownSources[file];

  if (!resolved) {
    throw new Error(`Unsupported markdown file: ${file}`);
  }

  if (
    typeof resolved === 'string' &&
    isAbsolute(resolved) &&
    resolved.endsWith('.md')
  ) {
    return await readFile(resolved, 'utf8');
  }

  if (
    typeof resolved === 'string' &&
    looksLikeRenderedHtml(resolved) &&
    canReadLocalMarkdown()
  ) {
    try {
      const localPath = fileURLToPath(new URL(`../${file}`, import.meta.url));
      return await readFile(localPath, 'utf8');
    } catch {
      // Fall through to the bundled string when local file access is unavailable.
    }
  }

  return resolved;
}

function canReadLocalMarkdown() {
  return typeof process !== 'undefined' && typeof process.cwd === 'function';
}

function looksLikeRenderedHtml(content: string) {
  const trimmed = content.trimStart();

  return /^<(?:h\d|p|ul|ol|li|pre|code|blockquote|table)\b/i.test(trimmed);
}

async function getDocSectionContent(
  file: MarkdownSourceKey,
  heading?: string | null,
): Promise<DocSectionResult> {
  if (!markdownSources[file]) {
    return {
      ok: false,
      message: `The file "${file}" is not available for reading.`,
    };
  }

  try {
    const markdown = await loadMarkdownFile(file);

    if (!heading) {
      return { ok: true, content: markdown.trim() };
    }

    const section = extractMarkdownSection(markdown, heading);

    if (!section) {
      return {
        ok: false,
        message: `Heading "${heading}" was not found in ${file}.`,
      };
    }

    const text = `${section.heading}\n${section.content}`.trim();
    return { ok: true, content: text };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, message: `Could not read ${file}: ${message}` };
  }
}

async function searchMarkdownSources(
  query: string,
  options: { file?: MarkdownSourceKey; limit?: number } = {},
): Promise<DocSearchResult[]> {
  const normalizedQuery = query.toLowerCase();
  const files = options.file ? [options.file] : Object.keys(markdownSources);
  const results: DocSearchResult[] = [];
  const maxResults = options.limit ?? 10;

  for (const file of files) {
    if (!markdownSources[file as MarkdownSourceKey]) continue;

    const markdown = await loadMarkdownFile(file as MarkdownSourceKey);
    const lines = markdown.split(/\r?\n/);
    const sections = getMarkdownSections(lines, file as string);

    for (const section of sections) {
      if (results.length >= maxResults) break;

      const normalizedHeading = section.heading.toLowerCase();
      const contentText = section.content.join('\n').toLowerCase();
      const isMatch =
        normalizedHeading.includes(normalizedQuery) ||
        contentText.includes(normalizedQuery);

      if (!isMatch) continue;

      const matchIndex = section.content.findIndex((line) =>
        line.toLowerCase().includes(normalizedQuery),
      );
      const excerptStart = Math.max(0, matchIndex === -1 ? 0 : matchIndex - 1);
      const excerptEnd = Math.min(
        section.content.length,
        matchIndex === -1 ? 3 : matchIndex + 2,
      );

      results.push({
        file: file as MarkdownSourceKey,
        heading: section.heading,
        startLine: section.startLine,
        endLine: section.endLine,
        excerpt: section.content.slice(excerptStart, excerptEnd).join('\n'),
      });
    }

    if (results.length >= maxResults) break;
  }

  return results;
}

export type {
  AgentCapability,
  DocSectionResult,
  MarkdownSourceKey,
  ToyMetadata,
};
export {
  asTextResponse,
  buildDocPointers,
  createMcpServer,
  extractMarkdownSection,
  extractRuntimeRange,
  extractSection,
  extractSectionWithRange,
  getDocSectionContent,
  getMarkdownSections,
  getReadmeDevCommands,
  loadReadme,
  loadReadmeLines,
  markdownSources,
  normalizeToys,
  registerTools,
  searchMarkdownSources,
};
