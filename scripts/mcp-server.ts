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
  controls: string[];
  module: string | null;
  type: string | null;
  allowWebGLFallback: boolean;
  url: string;
};

const markdownSources = {
  'README.md': path.join(repoRoot, 'README.md'),
  'docs/README.md': path.join(repoRoot, 'docs/README.md'),
  'docs/MCP_SERVER.md': path.join(repoRoot, 'docs/MCP_SERVER.md'),
  'docs/DEVELOPMENT.md': path.join(repoRoot, 'docs/DEVELOPMENT.md'),
  'docs/TOY_DEVELOPMENT.md': path.join(repoRoot, 'docs/TOY_DEVELOPMENT.md'),
  'docs/TOY_SCRIPT_INDEX.md': path.join(repoRoot, 'docs/TOY_SCRIPT_INDEX.md'),
  'docs/toys.md': path.join(repoRoot, 'docs/toys.md'),
} as const;

type MarkdownSourceKey = keyof typeof markdownSources;

type DocSectionResult =
  | { ok: true; content: string }
  | { ok: false; message: string };

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
      'Return structured toy metadata (including controls and module info) from assets/js/toys-data.js with optional slug or WebGPU filters.',
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
  'read_doc_section',
  {
    description:
      'Return an entire markdown file or a specific heading section from README.md or docs/*.md.',
    inputSchema: z
      .object({
        file: z
          .enum(Object.keys(markdownSources) as [MarkdownSourceKey, ...MarkdownSourceKey[]])
          .describe('Markdown file to read (e.g., README.md or docs/MCP_SERVER.md).'),
        heading: z
          .string()
          .trim()
          .optional()
          .describe('Optional heading text to narrow the response to a single section.'),
      })
      .strict(),
  },
  async ({ file, heading }) => {
    const result = await getDocSectionContent(file, heading);

    return asTextResponse(result.ok ? result.content : result.message);
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

const transport = new StdioServerTransport();
async function startServer() {
  await server.connect(transport);
  console.error('Stim Webtoys MCP server is running on stdio.');
}

if (import.meta.main) {
  await startServer();
}

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
  return extractMarkdownSection(markdown, heading)?.content ?? null;
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
      const module = typeof entry.module === 'string' ? entry.module : null;
      const type = typeof entry.type === 'string' ? entry.type : null;
      const allowWebGLFallback = typeof entry.allowWebGLFallback === 'boolean' ? entry.allowWebGLFallback : false;
      const controls = Array.isArray(entry.controls)
        ? entry.controls.filter((control): control is string => typeof control === 'string')
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
        url: `toy.html?toy=${encodeURIComponent(slug)}`,
      };
    })
    .filter((entry): entry is ToyMetadata => Boolean(entry));
}

function extractMarkdownSection(markdown: string, heading: string) {
  const pattern = new RegExp(`^(#{1,6}\\s+${escapeForRegex(heading)})\\s*$`, 'm');
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

async function loadMarkdownFile(file: MarkdownSourceKey) {
  const resolved = markdownSources[file];

  if (!resolved) {
    throw new Error(`Unsupported markdown file: ${file}`);
  }

  return readFile(resolved, 'utf8');
}

async function getDocSectionContent(file: MarkdownSourceKey, heading?: string | null): Promise<DocSectionResult> {
  if (!markdownSources[file]) {
    return { ok: false, message: `The file "${file}" is not available for reading.` };
  }

  try {
    const markdown = await loadMarkdownFile(file);

    if (!heading) {
      return { ok: true, content: markdown.trim() };
    }

    const section = extractMarkdownSection(markdown, heading);

    if (!section) {
      return { ok: false, message: `Heading "${heading}" was not found in ${file}.` };
    }

    const text = `${section.heading}\n${section.content}`.trim();
    return { ok: true, content: text };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, message: `Could not read ${file}: ${message}` };
  }
}

export type { ToyMetadata };
export {
  buildDocPointers,
  extractMarkdownSection,
  extractRuntimeRange,
  extractSection,
  extractSectionWithRange,
  getDocSectionContent,
  loadReadme,
  loadReadmeLines,
  normalizeToys,
  startServer,
};
