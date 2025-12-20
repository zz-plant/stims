import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import toysData from '../assets/js/toys-data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const server = new McpServer(
  { name: 'stim-webtoys-mcp', version: '1.0.0' },
  {
    capabilities: { tools: {} },
    instructions:
      'Use these tools to surface documentation, toy metadata, loader behavior, and development commands for the Stim Webtoys library.',
  },
);

type ToyMetadata = {
  slug: string;
  title: string;
  description: string;
  requiresWebGPU: boolean;
  url: string;
};

server.registerTool(
  'list_docs',
  {
    description:
      'Return quick-start, runtime, repository layout, and toy catalog pointers from README.md with line references.',
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
      'Return structured toy metadata from assets/js/toys-data.js with optional slug or WebGPU filters.',
    inputSchema: z
      .object({
        slug: z.string().trim().optional().describe('Limit results to a specific toy slug.'),
        requiresWebGPU: z
          .boolean()
          .optional()
          .describe('Filter by WebGPU requirement (true = only WebGPU toys).'),
      })
      .strict(),
  },
  async ({ slug, requiresWebGPU }) => {
    const toys = normalizeToys(toysData);

    const filtered = toys.filter((toy) => {
      if (slug && toy.slug !== slug) return false;
      if (typeof requiresWebGPU === 'boolean' && toy.requiresWebGPU !== requiresWebGPU) return false;
      return true;
    });

    if (!filtered.length) {
      return asTextResponse('No toys matched the requested filters.');
    }

    return {
      content: [
        {
          type: 'json',
          json: filtered,
        },
      ],
    } as const;
  },
);

server.registerTool(
  'describe_loader',
  {
    description: 'Summarize how toy loading and error handling works based on assets/js/loader.ts.',
    inputSchema: z.object({}).strict(),
  },
  async () => {
    const loaderDetails = [
      '- Loader derives the manifest path from the current URL to resolve compiled module files (`/.vite/manifest.json`).',
      '- Query param `toy` controls navigation; history updates keep the slug in the URL and restore the library view when removed.',
      '- `loadToy` clears any active toy, shows the active container, and gates WebGPU-only entries before importing modules.',
      '- Imports are resolved through Vite manifest entries when available, with fallbacks for relative and absolute module paths.',
      '- Visible status blocks appear while loading; errors render actionable messages for missing dev server, MIME mismatches, or file:// access.',
      '- A reusable “Back to Library” control and history updates let users return to the catalog without reloads.',
    ];

    return asTextResponse(loaderDetails.join('\n'));
  },
);

server.registerTool(
  'dev_commands',
  {
    description: 'Return installation and development commands from README.md.',
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
    const readme = await loadReadme();
    const quickStart = extractSection(readme, 'Quick Start');
    const localSetup = extractSection(readme, 'Local Setup');
    const helpfulScripts = extractSection(readme, 'Helpful Scripts (npm or Bun)');
    const tests = extractSection(readme, 'Running Tests');
    const linting = extractSection(readme, 'Linting and Formatting');

    const sections: Record<string, string | null> = {
      setup: quickStart && localSetup ? `${quickStart}\n\n${localSetup}` : quickStart ?? localSetup,
      dev: helpfulScripts,
      build: helpfulScripts,
      test: tests,
      lint: linting,
    };

    const text = scope ? sections[scope] : [quickStart, localSetup, helpfulScripts, tests, linting].filter(Boolean).join('\n\n');

    return asTextResponse(text || 'No development guidance was found in README.md.');
  },
);

server.registerTool(
  'agent_workflow',
  {
    description:
      'Surface best practices for MCP-driven development in this repo, including quick context and tool usage tips.',
    inputSchema: z.object({}).strict(),
  },
  async () => {
    const guidance = [
      '- Run `bun run mcp` from the repository root so README and toy metadata are available to tools.',
      '- Start with `list_docs` to pull quick-start, runtime, layout, and toy catalog context before making changes.',
      '- Use `dev_commands` with scopes (setup, dev, build, test, lint) to copy-paste the exact commands for your workflow.',
      '- Call `get_toys` with `slug` or `requiresWebGPU` when you need precise toy metadata for docs or debugging.',
      '- Reach for `describe_loader` when investigating loader behavior, entry resolution, or WebGPU gating.',
      '- Keep the repo synchronized with Bun installs and Vite artifacts (manifest) when testing loader paths.',
      '- Use the MCP outputs as citations in PRs or reviews so changes reference specific README sections or toy data.',
    ];

    return asTextResponse(guidance.join('\n'));
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Stim Webtoys MCP server is running on stdio.');

async function loadReadme() {
  const readmePath = path.join(repoRoot, 'README.md');
  return readFile(readmePath, 'utf8');
}

async function loadReadmeLines() {
  const readme = await loadReadme();
  return readme.split(/\r?\n/);
}

type SectionExcerpt = {
  startLine: number;
  endLine: number;
  content: string[];
};

async function buildDocPointers() {
  const lines = await loadReadmeLines();

  const quickStart = extractSectionWithRange(lines, 'Quick Start');
  const layout = extractSectionWithRange(lines, 'Repository Layout');
  const toys = extractSectionWithRange(lines, 'Toys in the Collection');
  const runtime = extractRuntimeRange(lines);

  const entries = [
    quickStart && formatPointer('Quick start steps', quickStart),
    runtime && formatPointer('Runtime options (Bun / Node)', runtime),
    layout && formatPointer('Repository layout', layout),
    toys && formatPointer('Toy catalog link targets', toys),
  ].filter(Boolean) as string[];

  return entries.join('\n\n');
}

function formatPointer(title: string, excerpt: SectionExcerpt) {
  const range = `README.md:L${excerpt.startLine}-L${excerpt.endLine}`;
  return `${title} (${range})\n${excerpt.content.join('\n')}`;
}

function extractSectionWithRange(lines: string[], heading: string): SectionExcerpt | null {
  const headingIndex = lines.findIndex((line) => line.trim() === `## ${heading}`);

  if (headingIndex === -1) return null;

  const nextHeadingOffset = lines.slice(headingIndex + 1).findIndex((line) => line.trim().startsWith('## '));
  const nextHeadingIndex = nextHeadingOffset === -1 ? lines.length : headingIndex + 1 + nextHeadingOffset;
  const endIndex = Math.max(headingIndex, nextHeadingIndex - 1);

  return {
    startLine: headingIndex + 1,
    endLine: endIndex + 1,
    content: lines.slice(headingIndex, nextHeadingIndex),
  };
}

function extractRuntimeRange(lines: string[]): SectionExcerpt | null {
  const startIndex = lines.findIndex((line) => line.includes('Choose your runtime'));

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
  const pattern = new RegExp(`^##\\s+${escapeForRegex(heading)}\\s*$`, 'm');
  const match = pattern.exec(markdown);

  if (!match) return null;

  const startIndex = match.index + match[0].length;
  const rest = markdown.slice(startIndex);
  const nextHeading = rest.search(/^##\s+/m);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  return section.trim();
}

function escapeForRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function asTextResponse(text: string) {
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  } as const;
}

function normalizeToys(data: unknown): ToyMetadata[] {
  if (!Array.isArray(data)) return [];

  return data
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const entry = item as Record<string, unknown>;

      const slug = typeof entry.slug === 'string' ? entry.slug : null;
      const title = typeof entry.title === 'string' ? entry.title : '';
      const description = typeof entry.description === 'string' ? entry.description : '';
      const requiresWebGPU = typeof entry.requiresWebGPU === 'boolean' ? entry.requiresWebGPU : false;

      if (!slug) return null;

      return {
        slug,
        title: title || slug,
        description,
        requiresWebGPU,
        url: `toy.html?toy=${encodeURIComponent(slug)}`,
      };
    })
    .filter((entry): entry is ToyMetadata => Boolean(entry));
}
