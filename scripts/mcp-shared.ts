import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { jsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/types.js';
import { z } from 'zod';
import toysData from '../assets/js/toys-metadata.ts';
import { validateToyMetadata, type ValidatedToyEntry } from '../assets/js/utils/toy-schema.ts';
import docsDevelopment from '../docs/DEVELOPMENT.md?raw';
import docsMcpServer from '../docs/MCP_SERVER.md?raw';
import docsReadme from '../docs/README.md?raw';
import docsToyDevelopment from '../docs/TOY_DEVELOPMENT.md?raw';
import docsToyScriptIndex from '../docs/TOY_SCRIPT_INDEX.md?raw';
import docsToys from '../docs/toys.md?raw';
import readme from '../README.md?raw';

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
} as const;

type MarkdownSourceKey = keyof typeof markdownSources;

type DocSectionResult =
  | { ok: true; content: string }
  | { ok: false; message: string };

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
  module: string;
  type: ValidatedToyEntry['type'];
  allowWebGLFallback: boolean;
  url: string;
};

const serverInfo = { name: 'stim-webtoys-mcp', version: '1.0.0' } as const;

function createMcpServer({ instructions = defaultInstructions, jsonSchemaValidator }: CreateServerOptions = {}) {
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
        'Return structured toy metadata (including controls and module info) from the validated assets/js/toys-data.js entries with optional slug or WebGPU filters.',
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
      const readmeContent = await loadReadme();
      const quickStart = extractSection(readmeContent, 'Quick Start');
      const localSetup = extractSection(readmeContent, 'Local Setup');
      const helpfulScripts = extractSection(readmeContent, 'Helpful Scripts (npm or Bun)');
      const tests = extractSection(readmeContent, 'Running Tests');
      const linting = extractSection(readmeContent, 'Linting and Formatting');

      const sections: Record<string, string | null> = {
        setup: quickStart && localSetup ? `${quickStart}\n\n${localSetup}` : quickStart ?? localSetup,
        dev: helpfulScripts,
        build: helpfulScripts,
        test: tests,
        lint: linting,
      };

      const text = scope
        ? sections[scope]
        : [quickStart, localSetup, helpfulScripts, tests, linting].filter(Boolean).join('\n\n');

      return asTextResponse(text || 'No development guidance was found in README.md.');
    },
  );
}

async function loadReadme() {
  return markdownSources['README.md'];
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

function normalizeToys(data: unknown = toysData): ToyMetadata[] {
  const source: ValidatedToyEntry[] =
    Array.isArray(data) &&
    data.every((item) => Boolean(item && typeof item === 'object' && 'capabilityPolicy' in item))
      ? (data as ValidatedToyEntry[])
      : validateToyMetadata(data);

  return source.map((toy) => ({
    slug: toy.slug,
    title: toy.title,
    description: toy.description,
    requiresWebGPU: toy.capabilityPolicy.requiresWebGPU,
    controls: toy.controls,
    module: toy.module,
    type: toy.capabilityPolicy.entryType,
    allowWebGLFallback: toy.capabilityPolicy.allowWebGLFallback,
    url: `toy.html?toy=${encodeURIComponent(toy.slug)}`,
  }));
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

  return resolved;
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

export type { DocSectionResult, MarkdownSourceKey, ToyMetadata };
export {
  asTextResponse,
  buildDocPointers,
  createMcpServer,
  extractMarkdownSection,
  extractRuntimeRange,
  extractSection,
  extractSectionWithRange,
  getDocSectionContent,
  loadReadme,
  loadReadmeLines,
  markdownSources,
  normalizeToys,
  registerTools,
};
